from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator


class _Credentials(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email", mode="before")
    @classmethod
    def _normalize_email(cls, v):
        return v.strip().lower() if isinstance(v, str) else v


class RegisterRequest(_Credentials):
    password: str = Field(min_length=8, max_length=128)
    invite_token: Annotated[str, StringConstraints(strip_whitespace=True, min_length=20, max_length=200)] | None = None


class LoginRequest(_Credentials):
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    """The only shape a user is ever exposed in. No hash, no token, ever."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    name: str  # display_name, or a readable fallback derived from the email
    display_name: str
    avatar_color: str
    is_active: bool
    email_verified: bool


class ProfileUpdate(BaseModel):
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)] | None = None
    avatar_color: Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)] | None = None


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class EmailTokenRequest(BaseModel):
    token: Annotated[str, StringConstraints(strip_whitespace=True, min_length=20, max_length=200)]


class PasswordResetRequest(BaseModel):
    email: EmailStr

    @field_validator("email", mode="before")
    @classmethod
    def _normalize_email(cls, v):
        return v.strip().lower() if isinstance(v, str) else v


class PasswordResetConfirm(BaseModel):
    token: Annotated[str, StringConstraints(strip_whitespace=True, min_length=20, max_length=200)]
    new_password: str = Field(min_length=8, max_length=128)


class AccountDeactivate(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class AccountDelete(AccountDeactivate):
    pass


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds until the access token expires
    user: UserOut
