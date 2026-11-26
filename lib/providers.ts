export type Provider = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  revokeUrl?: string;
};

export const providers: Record<string, Provider> = {
  slack: {
    tokenUrl: "https://slack.com/api/oauth.v2.user.access",
    clientId: "SLACK_CLIENT_ID",
    clientSecret: "SLACK_CLIENT_SECRET",
    revokeUrl: "https://slack.com/api/auth.revoke",
  },
};
