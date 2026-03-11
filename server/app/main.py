from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import image

app = FastAPI(
    title="__ API",
    description="API for __",
    version="1.0.0",
)

# CORS setup
origins = [
    "http://localhost:3000",  # React default
    "http://127.0.0.1:3000",
    "https://your-deployed-client-url.com",  # Add your deployed frontend URL here

]


app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # List of allowed origins
    allow_credentials=True,  # Allow cookies to be included
    allow_methods=["*"],  # Allow all HTTP methods (GET, POST, PUT, etc.)
    allow_headers=["*"],  # Allow all headers
)

# Include routers
app.include_router(image.router, prefix="/api/image", tags=["Image"])

@app.get("/")
def read_root():
    return {"message": "Welcome to __ API!"}

@app.get("/health", tags=["Health"])
def health_check():
    return {"status": "Server is running!"}