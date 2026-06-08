import sys
import os
import json
import asyncio
from notebooklm import NotebookLMClient

async def main():
    try:
        # Read request JSON from stdin
        input_data = json.loads(sys.stdin.read())
        notebook_id = input_data.get("notebook_id")
        conversation_id = input_data.get("conversation_id")
        prompt = input_data.get("prompt")

        if not notebook_id or not prompt:
            print(json.dumps({"error": "Missing notebook_id or prompt in input"}))
            return

        # Read cookies from env
        cookies_str = os.environ.get("NOTEBOOKLM_COOKIES")
        if not cookies_str:
            print(json.dumps({"error": "NOTEBOOKLM_COOKIES environment variable not set"}))
            return

        # Write to temporary file
        temp_storage_path = "storage_state_temp.json"
        try:
            cookies_json = json.loads(cookies_str)
            
            # Normalize cookies into Playwright format
            cookies_list = []
            if isinstance(cookies_json, dict) and "cookies" in cookies_json:
                raw_list = cookies_json["cookies"]
            elif isinstance(cookies_json, list):
                raw_list = cookies_json
            else:
                raw_list = []

            for cookie in raw_list:
                clean_cookie = {
                    "name": cookie.get("name"),
                    "value": cookie.get("value"),
                    "domain": cookie.get("domain"),
                    "path": cookie.get("path", "/")
                }
                
                # Handle expires / expirationDate
                expires = cookie.get("expires")
                if expires is None and "expirationDate" in cookie:
                    expires = cookie["expirationDate"]
                if expires is not None:
                    clean_cookie["expires"] = float(expires)
                
                # Handle boolean flags
                if "httpOnly" in cookie:
                    clean_cookie["httpOnly"] = bool(cookie["httpOnly"])
                elif "http_only" in cookie:
                    clean_cookie["httpOnly"] = bool(cookie["http_only"])
                    
                if "secure" in cookie:
                    clean_cookie["secure"] = bool(cookie["secure"])
                    
                # Handle sameSite
                same_site = cookie.get("sameSite")
                if same_site:
                    same_site_lower = str(same_site).lower()
                    if same_site_lower in ["lax", "strict", "none"]:
                        clean_cookie["sameSite"] = same_site_lower.capitalize()
                    elif same_site_lower == "no_restriction":
                        clean_cookie["sameSite"] = "None"
                
                clean_cookie = {k: v for k, v in clean_cookie.items() if v is not None}
                cookies_list.append(clean_cookie)
                
            storage_state = {
                "cookies": cookies_list,
                "origins": cookies_json.get("origins", []) if isinstance(cookies_json, dict) else []
            }
            
            with open(temp_storage_path, "w", encoding="utf-8") as f:
                json.dump(storage_state, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(json.dumps({"error": f"Failed to parse, normalize or write cookies JSON: {str(e)}"}))
            return

        # Query NotebookLM
        try:
            async with NotebookLMClient.from_storage(temp_storage_path) as client:
                # If conversation_id is provided and not empty, use it
                if conversation_id:
                    result = await client.chat.ask(
                        notebook_id=notebook_id,
                        question=prompt,
                        conversation_id=conversation_id
                    )
                else:
                    result = await client.chat.ask(
                        notebook_id=notebook_id,
                        question=prompt
                    )
                
                # Output success JSON
                output = {
                    "answer": result.answer,
                    "conversation_id": result.conversation_id
                }
                print(json.dumps(output, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({"error": f"NotebookLM query failed: {str(e)}"}))
        finally:
            # Clean up temp file
            if os.path.exists(temp_storage_path):
                os.remove(temp_storage_path)

    except Exception as e:
        print(json.dumps({"error": f"Unhandled Python exception: {str(e)}"}))

if __name__ == "__main__":
    asyncio.run(main())
