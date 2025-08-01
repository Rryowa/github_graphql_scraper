export interface Repository {
	id: number
	name: string
	full_name: string
	stargazers_count: number
	html_url: string
}

export interface CodeSearchResultItem {
	name: string
	path: string
	repository: Repository
	html_url: string
}

export interface CodeSearchResult {
	total_count: number
	items: CodeSearchResultItem[]
}

export interface Edge {
	node: {
		nameWithOwner: string
		stargazerCount: number
	}
}

export interface GraphQLResponse {
	data: {
		search: {
			edges: Edge[]
		}
	}
}
