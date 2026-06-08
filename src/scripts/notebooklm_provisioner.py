import sys
import os
import json
import asyncio
from notebooklm import NotebookLMClient

async def main():
    try:
        # Read request JSON from stdin
        input_data = json.loads(sys.stdin.read())
        title = input_data.get("title")
        instructions = input_data.get("instructions")
        gm_prompt = input_data.get("gm_prompt")
        grimorio_content = input_data.get("grimorio_content")
        enciclopedia_content = input_data.get("enciclopedia_content")

        if not title or not instructions or not gm_prompt:
            print(json.dumps({"error": "Missing title, instructions or gm_prompt in input"}))
            return

        # Read cookies from env
        cookies_str = os.environ.get("NOTEBOOKLM_COOKIES")
        if not cookies_str:
            print(json.dumps({"error": "NOTEBOOKLM_COOKIES environment variable not set"}))
            return

        # Write to temporary file
        temp_storage_path = "storage_state_provision_temp.json"
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
                expires = cookie.get("expires")
                if expires is None and "expirationDate" in cookie:
                    expires = cookie["expirationDate"]
                if expires is not None:
                    clean_cookie["expires"] = float(expires)
                
                if "httpOnly" in cookie:
                    clean_cookie["httpOnly"] = bool(cookie["httpOnly"])
                elif "http_only" in cookie:
                    clean_cookie["httpOnly"] = bool(cookie["http_only"])
                    
                if "secure" in cookie:
                    clean_cookie["secure"] = bool(cookie["secure"])
                    
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

        # Create Notebook and Add Sources
        try:
            async with NotebookLMClient.from_storage(temp_storage_path) as client:
                # 1. Create the Notebook
                notebook_title = f"[GM] {title}"
                nb = await client.notebooks.create(notebook_title)
                
                # 2. Add System Prompt Source
                await client.sources.add_text(
                    notebook_id=nb.id,
                    text=gm_prompt,
                    title="Reglas Generales del Game Master (GM)"
                )
                
                # 3. Add Mission Instructions Source
                await client.sources.add_text(
                    notebook_id=nb.id,
                    text=instructions,
                    title=f"Lore e Indicaciones de la Mision - {title}"
                )

                # 4. Add Grimoire Source if provided
                if grimorio_content:
                    await client.sources.add_text(
                        notebook_id=nb.id,
                        text=grimorio_content,
                        title="Grimorio Oficial de Magias y Hechizos"
                    )

                # 5. Add Encyclopedia Source if provided
                if enciclopedia_content:
                    await client.sources.add_text(
                        notebook_id=nb.id,
                        text=enciclopedia_content,
                        title="Enciclopedia y Codex del Reino"
                    )
                
                # Output success JSON
                output = {
                    "notebook_id": nb.id
                }
                print(json.dumps(output, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({"error": f"NotebookLM provision failed: {str(e)}"}))
        finally:
            # Clean up temp file
            if os.path.exists(temp_storage_path):
                os.remove(temp_storage_path)

    except Exception as e:
        print(json.dumps({"error": f"Unhandled Python exception: {str(e)}"}))

if __name__ == "__main__":
    asyncio.run(main())
