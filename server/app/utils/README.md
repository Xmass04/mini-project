# Server Utils - Supabase Integration

This folder contains utility functions for connecting to and interacting with Supabase.

## Files

### `supabase_client.py`
Main Supabase client setup with authentication utilities.

**Key Functions:**

- `init_supabase()` - Initialize and cache the Supabase client
- `get_supabase_client()` - Get a standard Supabase client instance
- `get_supabase_service_client()` - Get a service-role privileged client
- `get_current_user(access_token)` - Get user from access token
- `sign_up(email, password)` - Register new user
- `sign_in(email, password)` - Login user
- `sign_out(access_token)` - Logout user
- `refresh_session(refresh_token)` - Refresh authentication session

### `example_auth_routes.py`
Example FastAPI routes showing how to use the Supabase utilities for authentication and database queries.

### `__init__.py`
Package initialization file that exports all public utilities.

## Setup

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure environment variables:**
   Make sure your `server/.env` file contains:
   ```
   SUPABASE_URL=your-project-url
   SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

## Usage Examples

### Basic Initialization
```python
from server.utils import init_supabase

client = init_supabase()
```

### Authentication
```python
from server.utils import sign_in, get_current_user

# Sign in
session = sign_in("user@example.com", "password")
access_token = session.session.access_token

# Get user info
user = get_current_user(access_token)
```

### Database Queries
```python
from server.utils import init_supabase

client = init_supabase()

# Query a table
response = client.table("users").select("*").execute()
data = response.data

# Insert data
response = client.table("users").insert({"name": "John", "email": "john@example.com"}).execute()

# Update data
response = client.table("users").update({"name": "Jane"}).eq("id", 1).execute()

# Delete data
response = client.table("users").delete().eq("id", 1).execute()
```

### Using Service Role Client (for server-side operations)
```python
from server.utils import get_supabase_service_client

# Use for operations that need elevated permissions
client = get_supabase_service_client()
response = client.table("users").select("*").execute()
```

## Integration with FastAPI

To use in your FastAPI app, include the example routes:

```python
from fastapi import FastAPI
from server.utils.example_auth_routes import router

app = FastAPI()
app.include_router(router)
```

Or use the utilities in your own routes:

```python
from fastapi import APIRouter, HTTPException
from server.utils import sign_in

router = APIRouter()

@router.post("/login")
def login(email: str, password: str):
    response = sign_in(email, password)
    if response is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return response
```

## Error Handling

All functions include basic error handling. For production, you may want to add:
- Custom exception classes
- Logging
- Rate limiting for auth endpoints
- Token validation middleware

## Documentation

- [Supabase Python Client Docs](https://supabase.com/docs/reference/python/introduction)
- [Supabase Auth Docs](https://supabase.com/docs/guides/auth)
