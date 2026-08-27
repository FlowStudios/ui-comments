export interface UICommentsConfig {
  /** "owner/repo". Defaults to $UI_COMMENTS_REPO. */
  repo?: string;
  /** Fine-grained PAT with Issues: write. Defaults to $UI_COMMENTS_GH_TOKEN. */
  token?: string;
  /** Created if missing. Pass null to file unlabelled issues. */
  label?: string | null;
  /** Prepended to the issue title. Default "[UI] ". */
  titlePrefix?: string;
  assignees?: string[];
}

export interface UICommentPayload {
  comment: string;
  project?: string;
  page?: { url?: string; path?: string; title?: string };
  viewport?: { w?: number; h?: number; dpr?: number; theme?: string; scrollY?: number };
  element?: {
    tag?: string;
    id?: string;
    classes?: string;
    selector?: string;
    selectorMatches?: number;
    selectorUnique?: boolean;
    text?: string;
    html?: string;
    attrs?: Record<string, string>;
    rect?: { x?: number; y?: number; w?: number; h?: number };
  };
  meta?: { userAgent?: string; at?: string };
  context?: unknown;
}

export function createIssue(
  payload: UICommentPayload,
  config: UICommentsConfig,
): Promise<{ status: number; body: { ok?: true; number?: number; url?: string; error?: string } }>;

export function bodyFrom(payload: UICommentPayload): string;
export function titleFrom(comment: string, prefix: string): string;
export function validate(payload: UICommentPayload): string | null;
