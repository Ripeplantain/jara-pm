from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class _Credentials(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email", mode="before")
    @classmethod
    def _normalize_email(cls, v):
        return v.strip().lower() if isinstance(v, str) else v


class RegisterRequest(_Credentials):
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(_Credentials):
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds until the access token expires
    user: UserOut
