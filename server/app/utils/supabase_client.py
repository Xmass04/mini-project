"""
Supabase client setup and authentication utilities.
"""

import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Initialize Supabase client
def get_supabase_client() -> Client:
    """
    Get or create a Supabase client instance.
    
    Returns:
        Client: Supabase client instance
        
    Raises:
        ValueError: If SUPABASE_URL or SUPABASE_ANON_KEY are not set
    """
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_ANON_KEY")
    
    if not supabase_url or not supabase_key:
        raise ValueError(
            "SUPABASE_URL and SUPABASE_ANON_KEY must be set in environment variables"
        )
    
    return create_client(supabase_url, supabase_key)


def get_supabase_service_client() -> Client:
    """
    Get a Supabase client with service role privileges.
    Use this for server-side operations that require elevated permissions.
    
    Returns:
        Client: Supabase service client instance
        
    Raises:
        ValueError: If SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are not set
    """
    supabase_url = os.getenv("SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    
    if not supabase_url or not service_role_key:
        raise ValueError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment variables"
        )
    
    return create_client(supabase_url, service_role_key)


# Singleton instance for the standard client
_supabase_client: Client | None = None


def init_supabase() -> Client:
    """
    Initialize and cache the Supabase client.
    
    Returns:
        Client: Cached Supabase client instance
    """
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = get_supabase_client()
    return _supabase_client


# Authentication utilities
def get_current_user(access_token: str) -> dict:
    """
    Get the current user from an access token.
    
    Args:
        access_token: JWT access token from Supabase auth
        
    Returns:
        dict: User data if valid, None otherwise
    """
    try:
        client = init_supabase()
        user = client.auth.get_user(access_token)
        return user
    except Exception as e:
        print(f"Error getting user from token: {e}")
        return None


def sign_up(email: str, password: str) -> dict:
    """
    Sign up a new user.
    
    Args:
        email: User email
        password: User password
        
    Returns:
        dict: Response with user and session data
    """
    try:
        client = init_supabase()
        response = client.auth.sign_up({"email": email, "password": password})
        return response
    except Exception as e:
        print(f"Error signing up: {e}")
        return None


def sign_in(email: str, password: str) -> dict:
    """
    Sign in an existing user.
    
    Args:
        email: User email
        password: User password
        
    Returns:
        dict: Response with user and session data (access_token, etc.)
    """
    try:
        client = init_supabase()
        response = client.auth.sign_in_with_password({"email": email, "password": password})
        return response
    except Exception as e:
        print(f"Error signing in: {e}")
        return None


def sign_out(access_token: str) -> bool:
    """
    Sign out a user.
    
    Args:
        access_token: JWT access token from Supabase auth
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        client = init_supabase()
        client.auth.sign_out(access_token)
        return True
    except Exception as e:
        print(f"Error signing out: {e}")
        return False


def refresh_session(refresh_token: str) -> dict:
    """
    Refresh an authentication session using refresh token.
    
    Args:
        refresh_token: Refresh token from previous session
        
    Returns:
        dict: New session data with fresh access_token
    """
    try:
        client = init_supabase()
        response = client.auth.refresh_session(refresh_token)
        return response
    except Exception as e:
        print(f"Error refreshing session: {e}")
        return None
