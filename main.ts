import { parse } from 'https://deno.land/std@0.119.0/flags/mod.ts'
import { config } from 'https://deno.land/x/dotenv/mod.ts'
import {
	CodeSearchResult,
	CodeSearchResultItem,
	Edge,
	GraphQLResponse,
	Repository,
} from './domain.ts'

config({ export: true })

const GITHUB_API_URL = 'https://api.github.com/search/code'
const TOKEN = Deno.env.get('GITHUB_TOKEN')

async function main() {
	if (!TOKEN) {
		console.error('Error: GITHUB_TOKEN environment variable not set.')
		console.error('Please set it to your personal GitHub access token in the .env file.')
		Deno.exit(1)
	}
	const flags = parse(Deno.args, {
		string: ['filename', 'search'],
		boolean: ['help'],
	})

	if (flags.help || (!flags.filename && !flags.search)) {
		printUsage()
		return
	}

	const searchTerm = flags.filename || flags.search
	const searchType = flags.filename ? 'filename' : 'content'

	try {
		const repos = await fetchRepositories(searchTerm, searchType)
		console.log(`Found ${repos.length} unique repositories.`)

		const reposWithStars = await enrichWithStarCount(repos)

		const filteredRepos = reposWithStars.filter((repo) => repo.stargazers_count >= 100)

		console.log('=== Final Results ===')
		console.log(`Repositories with >=100 stars: ${filteredRepos.length}`)

		printResults(filteredRepos)
	} catch (error) {
		if (error instanceof Error) {
			console.error('Fatal error:', error.message)
		} else {
			console.error('An unknown error occurred:', error)
		}
	}
}

function printUsage() {
	console.log('Usage: deno run -A main.ts [options]')
	console.log('Options:')
	console.log('  --filename <name>    Search for repositories by filename.')
	console.log('  --search <query>     Search for repositories by code content.')
	console.log('  --help               Show this help message.')
}

async function fetchRepositories(
	searchTerm: string,
	type: 'filename' | 'content',
): Promise<Repository[]> {
	const uniqueRepos = new Map<number, Repository>()
	let page = 1
	const perPage = 30

	while (page <= 3) {
		const query = type === 'filename' ? `filename:${searchTerm}` : searchTerm
		const params = new URLSearchParams({
			q: query,
			per_page: perPage.toString(),
			page: page.toString(),
		})

		console.log(`Fetching page ${page} for "${searchTerm}"...`)
		const response = await fetch(`${GITHUB_API_URL}?${params}`, {
			headers: {
				Authorization: `token ${TOKEN}`,
				'User-Agent': 'Deno-Script',
				Accept: 'application/vnd.github.v3+json',
			},
		})

		if (!response.ok) {
			const error = await response.json()
			console.error(`API Error (page ${page}): ${error.message}`)
			break
		}

		const data: CodeSearchResult = await response.json()
		console.log(`Page ${page}: Found ${data.items.length} results`)

		data.items.forEach((item: CodeSearchResultItem) => {
			uniqueRepos.set(item.repository.id, item.repository)
		})

		await new Promise((resolve) => setTimeout(resolve, 1500))
		page++
	}
	return Array.from(uniqueRepos.values())
}

async function enrichWithStarCount(repos: Repository[]): Promise<Repository[]> {
	if (repos.length === 0) {
		return []
	}
	console.log(
		`
Fetching star counts for ${repos.length} repositories via GraphQL...`,
	)

	const repoQueries = repos.map((repo) => `repo:${repo.full_name}`).join(' ')
	const query = `
    query {
      search(query: "${repoQueries}", type: REPOSITORY, first: ${repos.length}) {
        repositoryCount
        edges {
          node {
            ... on Repository {
              nameWithOwner
              stargazerCount
            }
          }
        }
      }
    }
  `

	try {
		const response = await fetch('https://api.github.com/graphql', {
			method: 'POST',
			headers: {
				Authorization: `bearer ${TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ query }),
		})

		if (!response.ok) {
			const error = await response.json()
			console.error(`GraphQL API Error: ${error.message}`)
			return repos // Return original repos
		}

		const result: GraphQLResponse = await response.json()
		const edges = result.data.search.edges

		const starMap = new Map<string, number>()
		edges.forEach((edge: Edge) => {
			starMap.set(edge.node.nameWithOwner, edge.node.stargazerCount)
		})

		const enrichedRepos = repos.map((repo) => {
			const stargazerCount = starMap.get(repo.full_name)
			if (stargazerCount !== undefined) {
				return { ...repo, stargazers_count: stargazerCount }
			}
			return repo
		})

		console.log(`Successfully enriched ${edges.length} repositories.`)
		return enrichedRepos
	} catch (error) {
		if (error instanceof Error) {
			console.error(`Failed to fetch from GraphQL API: ${error.message}`)
		} else {
			console.error('An unknown error occurred during GraphQL fetch:', error)
		}
		return repos // Return original repos on error
	}
}

function printResults(repos: Repository[]) {
	repos
		.sort((a, b) => b.stargazers_count - a.stargazers_count)
		.forEach((repo, i) => {
			console.log(`${i + 1}. ${repo.full_name} - ${repo.stargazers_count}★`)
			console.log(`   URL: ${repo.html_url}`)
		})
}

await main()
