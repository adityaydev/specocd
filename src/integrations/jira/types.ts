export interface JiraComment {
  author: string;
  created: string;
  body: string;
}

export interface JiraAttachment {
  filename: string;
  mimeType: string;
  size: number;
  created: string;
  content: string;
}

export interface JiraTicket {
  key: string;
  summary: string;
  description: string;
  status: string;
  issueType: string;
  priority: string | null;
  assignee: string | null;
  reporter: string | null;
  dueDate: string | null;
  labels: string[];
  created: string;
  updated: string;
  comments: JiraComment[];
  attachments: JiraAttachment[];
  url: string;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: string;
}
