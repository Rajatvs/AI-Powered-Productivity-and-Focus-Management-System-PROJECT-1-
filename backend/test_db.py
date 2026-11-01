
from database import client, db

try:
    client.admin.command("ping")
    print("MongoDB connected successfully!")
    print("Database:", db.name)

except Exception as e:
    print("MongoDB connection failed:", e)

finally:
    client.close()
