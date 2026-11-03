declare namespace google.accounts.oauth2 {
  interface TokenResponse {
    access_token: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  }

  interface TokenClient {
    requestAccessToken: (opts?: { prompt?: string }) => void;
  }

  function initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
  }): TokenClient;
}

declare const google: {
  accounts: {
    oauth2: typeof google.accounts.oauth2;
  };
};
