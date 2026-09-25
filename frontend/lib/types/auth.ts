/** Mirror backend schemas in backend/app/schemas/auth.py. */
export interface User {
  id: number;
  email: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  /** Seconds until the access token expires. */
  expires_in: number;
  user: User;
}
