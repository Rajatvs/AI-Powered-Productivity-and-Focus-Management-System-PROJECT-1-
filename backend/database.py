
import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
DB_NAME = os.getenv("MONGO_DB", "focusai")

if not MONGO_URI:
    raise RuntimeError("MONGO_URI is missing in .env")

client = MongoClient(
    MONGO_URI,
    serverSelectionTimeoutMS=10000
)

db = client[DB_NAME]

# Collections for FocusAI
tasks_collection = db["tasks"]
sessions_collection = db["sessions"]
preferences_collection = db["preferences"]
notes_collection = db["notes"]
