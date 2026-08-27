interface UICommentsProps {
  /** Your endpoint. Default "/api/ui-comment". */
  endpoint?: string;
  /** Free-form label carried into the issue body. */
  project?: string;
  /** Skip the ?uicomment=1 gate and always show the pill. */
  always?: boolean;
  /** Extra app state attached to every issue. */
  context?: Record<string, unknown> | ((el: Element) => unknown) | null;
}

/** Renders nothing; mounts the ui-comments client on the browser. */
export default function UIComments(props: UICommentsProps): null;
