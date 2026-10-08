/** Mirror backend schemas in backend/app/schemas/auth.py. */
export interface User {
  id: number;
  email: string;
  /** display_name, or a readable fallback derived from the email. */
  name: string;
  display_name: string;
  avatar_color: string;
  is_active: boolean;
  email_verified: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  /** Seconds until the access token expires. */
  expires_in: number;
  user: User;
}
