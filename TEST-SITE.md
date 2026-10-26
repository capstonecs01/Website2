# Test site on your own computer (free)

`start-test-site.bat` runs the website and the PDF translator on this computer
and gives it a temporary public address like `https://random-words.trycloudflare.com`,
using a free Cloudflare **Quick Tunnel**. Testers open that address from
anywhere and type the site password. Nothing is paid and no domain is needed.

What to expect:

- **The address changes every time** you start the test site. Send the new one
  to your testers each time.
- **This computer must stay on**, awake and online, with the windows open, while
  people test. Closing them stops the site.
- **The data stays on this computer.** The database and uploaded PDFs are in
  `backend/` as usual.
- **Only the website is reachable**, and only through the tunnel behind the site
  password. The translator and the rest of the computer are not exposed.
- Cloudflare offers Quick Tunnels for testing, with no uptime guarantee.

## One-time setup

1. **Install cloudflared.** In a terminal (PowerShell or Command Prompt) run
   ```
   winget install --id Cloudflare.cloudflared
   ```
   then close the terminal. Without winget: download
   `cloudflared-windows-amd64.exe` from
   https://github.com/cloudflare/cloudflared/releases/latest and put it in this folder.
2. **Make sure the site already works locally** (see `README.md`):
   `backend\.env` and `pdf-translator\.env` exist and have the same
   `TRANSLATOR_SECRET`. Node.js and Python must be installed.
3. **Choose the site password.** The first time you run
   `start-test-site.bat` it creates `test-site.env` and opens it in Notepad.
   Type a password after `SITE_PASSWORD=`, save, and run it again.
4. **Stop the computer from sleeping** while people test: Windows Settings →
   System → Power → set sleep to **Never** when plugged in.

`test-site.env` stays on this computer (it is not uploaded to GitHub). It has
two more settings:

| Setting | Meaning |
|---|---|
| `TRANSLATOR_TEST_MODE=1` | PDF translations are free placeholders. Set `0` for real translations with Claude (charged to the key in `pdf-translator\.env`). |
| `REQUIRE_EMAIL_VERIFICATION=false` | New accounts can log in straight away. |

Chat translation uses the Azure key in `backend\.env` as usual (empty key =
test mode).

## Each test session

1. Double-click **`start-test-site.bat`**.
2. It checks everything, builds the pages and opens three windows: **Junction
   translator**, **Junction website** and **Junction tunnel**. Leave them open.
3. The main window shows the address. It is also copied to the clipboard and
   saved in `test-site-address.txt`. It can take up to a minute before the
   address opens.
4. Send the address and the site password to your testers.
5. When you are done, press **Enter** in the main window. That closes the other
   windows and the address stops working.

If Windows asks whether to allow Node.js or Python through the firewall, you can
choose not to allow it. The tunnel does not need it.

## If something goes wrong

| What you see | What to do |
|---|---|
| "cloudflared was not found" | Install it (step 1 above), then open a new window and try again. |
| "Port 3001 (or 5000) is already in use" | The site is already running somewhere, for example `npm run dev`. Close those windows first. |
| "The tunnel did not start" | Look at the **Junction tunnel** window. School or office networks sometimes block tunnels: try another network. |
| The Documents page says the translator isn't running | Look at the **Junction translator** window for the error. Check `TRANSLATOR_SECRET` matches in both `.env` files. |
| The address shows an error page right after starting | Wait a minute and reload. |

For normal development nothing changes: `npm run dev` in `frontend` and
`backend` works as before, without the site password.
