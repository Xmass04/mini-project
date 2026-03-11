"""
Example usage of the Supabase client utilities.

This file demonstrates how to use the authentication and database functions.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..utils import (
    init_supabase,
    sign_up,
    sign_in,
    get_current_user,
    sign_out,
)


router = APIRouter()

class SignUpRequest(BaseModel):
    email: str
    password: str


class SignInRequest(BaseModel):
    email: str
    password: str


class SignOutRequest(BaseModel):
    access_token: str


@router.post("/signup")
def signup(request: SignUpRequest):
    """Sign up a new user."""
    try:
        response = sign_up(request.email, request.password)
        if response is None:
            raise HTTPException(status_code=400, detail="Sign up failed")
        return {
            "message": "User created successfully",
            "user": response.user,
            "session": response.session,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/signin")
def signin(request: SignInRequest):
    """Sign in an existing user."""
    try:
        response = sign_in(request.email, request.password)
        if response is None:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        return {
            "message": "User signed in successfully",
            "user": response.user,
            "session": response.session,
        }
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))


@router.post("/access-token")
def get_access_token(request: SignInRequest):
    """Get access token for a user."""
    try:
        response = sign_in(request.email, request.password)
        if response is None:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        return {
            "access_token": response.session.access_token,
            "refresh_token": response.session.refresh_token,
            "expires_in": response.session.expires_in,
            "token_type": "Bearer",
        }
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))


@router.post("/signout")
def signout(request: SignOutRequest):
    """Sign out a user."""
    try:
        success = sign_out(request.access_token)
        if not success:
            raise HTTPException(status_code=400, detail="Sign out failed")
        return {"message": "User signed out successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/me")
def get_me(access_token: str):
    """Get current user info."""
    try:
        user = get_current_user(access_token)
        if user is None:
            raise HTTPException(status_code=401, detail="Unauthorized")
        return {"user": user}
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))


# Example: Using Supabase client for database operations
@router.get("/example-query")
def example_database_query():
    """Example of querying a Supabase table."""
    try:
        client = init_supabase()
        
        # Example: Query a table called "users"
        response = client.table("users").select("*").limit(10).execute()
        
        return {"data": response.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
