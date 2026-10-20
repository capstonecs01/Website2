# Putting the test site online (Render)

This puts Junction and the PDF translator on [Render](https://render.com) as a
**private test site**: it has a normal `https://` address, but every visitor
must type a password before seeing anything. Your computer can be switched off.

Everything Render needs is in `render.yaml` (at the top of this repository).
Render reads it and creates both parts for you:

| Service | What it is | Cost |
|---|---|---|
| `junction` (web service) | The website: `backend/`, which also shows the built `frontend/` pages. Has a 1 GB disk for the database (`junction.db`) and uploaded files. | $7/month + $0.25/month for the disk |
| `translator` (private service) | `pdf-translator/server.py`. Only `junction` can reach it, not the internet. | $7/month |

Plus Claude API usage for real PDF translations, and Azure for real chat
translations. Both start in free test mode. Render charges by the second, so a
few weeks of testing costs a fraction of the monthly price.

**This repository is public.** Never put keys or passwords in its files. They
go into Render's settings (step 3), which only you can see.

## 1. Push the code to GitHub

In a terminal (or GitHub Desktop):

```
cd C:\Capstone2026\Website2
git add -A
git commit -m "Set up the Render test site"
git push
```

## 2. Create a Render account

1. Sign up at [render.com](https://render.com) **with GitHub** (the account that owns `capstonecs01`).
2. When Render asks which repositories it may see, allow `Website2`.
   (Later: GitHub → Settings → Applications → Render → Configure.)
3. Add a payment card under **Billing**. Starter services and disks are paid.

## 3. Create the services from the Blueprint

1. In Render: **New → Blueprint**.
2. Pick the **Website2** repository. Render finds `render.yaml` and lists
   `junction`, `translator` and the `junction-data` disk.
3. It asks for three values:
   - **SITE_PASSWORD**: the password testers will type. Pick something you can send them.
   - **ANTHROPIC_API_KEY**: your Claude API key. Use a key from its own
     workspace in the Claude Console with a monthly spend limit (see step 6).
     While the translator is in test mode it isn't used.
   - **AZURE_TRANSLATOR_KEY**: the chat translation key ("KEY 1" on the
     Translator resource's **Keys and Endpoint** page in the Azure portal).
     Leave it empty to keep chat translation in test mode.
4. Click **Apply**. The first build takes a few minutes per service.

Everything else is filled in automatically: the shared `TRANSLATOR_SECRET`, the
translator's private address, a random `JWT_SECRET`, and `DATA_DIR=/var/data`
(the disk). `AZURE_TRANSLATOR_REGION` is set to `japaneast`. If your Azure
resource is in another region, change it on `junction → Environment`.

## 4. Check it works (free)

1. Open the `junction` service in Render and click its address
   (`https://junction-….onrender.com`).
2. Type the site password. You stay signed in on that browser for 30 days.
3. **Log in → Explore as Company** (or sign up: email verification is switched
   off for the test, so new accounts can log in straight away).
4. Open **Documents**, upload a PDF and translate it. In test mode the result
   says `[test translation] …` and costs nothing.
5. In **Messages**, translate a chat message. Without an Azure key it comes back
   as `(test translation) …`.

## 5. Turn on real translations

**PDFs (Claude):**

1. In Render open **translator → Environment**.
2. Make sure `ANTHROPIC_API_KEY` is filled in.
3. Change `TRANSLATOR_TEST_MODE` to `0` and save. The translator restarts by itself.

Each person can start 5 PDF translations a day (`TRANSLATIONS_PER_DAY` on
`junction`) of up to 20 pages (`MAX_PAGES` on `translator`).

**Chat (Azure):** on `junction → Environment`, fill in `AZURE_TRANSLATOR_KEY`
(and fix `AZURE_TRANSLATOR_REGION` if needed) and save.

## 6. Put a ceiling on Claude costs

In the [Claude Console](https://platform.claude.com): create a workspace (for
example "Junction test"), make the API key inside it, and set a monthly spend
limit on that workspace. If the limit is reached, PDF translations stop until
the next month instead of running up a bill.

## 7. Invite testers

Send them the site address and the site password. Ask them not to upload
confidential or personal documents. The password page and the site follow the
language (EN / 日本語) and light/dark choice each tester picks.

## Day-to-day

- **Updating the site:** push to `main` and Render redeploys on its own. While
  `junction` restarts the site is down for a few seconds. If `translator`
  restarts, a PDF translation in progress fails (the person just clicks
  translate again). Avoid pushing while people are testing.
- **Changing the password:** `junction → Environment → SITE_PASSWORD`. Everyone
  has to type the new one.
- **Pausing between test rounds:** each service has **Suspend** in its
  Settings. Suspended services don't run up compute charges, and the disk keeps
  your data. Resume `translator` first, then `junction`.
- **Logs:** each service has a **Logs** tab. Errors from the PDF translator show
  up there with `[translator]` in front, chat translation errors with
  `[azure-translator]`.
- **Backups:** Render takes a snapshot of the disk every day and keeps it for at
  least 7 days.

## If something goes wrong

| What you see | What to do |
|---|---|
| Documents page: "The translator isn't running right now" | Open **translator → Logs**. If it keeps restarting with "out of memory", change its plan to `1c-2g` ($25/month). |
| PDF translation fails with "Claude API key is missing or wrong" | Check `ANTHROPIC_API_KEY` on `translator`, or switch back to test mode. |
| Chat translation: "isn't set up correctly" | Check `AZURE_TRANSLATOR_KEY` and `AZURE_TRANSLATOR_REGION` on `junction`. |
| Every page sends you back to the password screen | Cookies are blocked for the site in that browser. |
| Accounts or files disappeared | Check `junction → Disks` is attached and `DATA_DIR` is `/var/data`. |

## Running on your computer

Nothing changes: follow `README.md` as before. `DATA_DIR`, `SITE_PASSWORD` and
`REQUIRE_EMAIL_VERIFICATION` are only set on Render, so locally the database
and uploads stay in `backend/`, there is no site password, and email
verification works as before.
