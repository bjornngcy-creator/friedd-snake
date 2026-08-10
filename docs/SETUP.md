# Setting this up on a new computer

This is for the owner, not a developer. You almost never need to do this — the live
site (https://friedd-snake.vercel.app) updates itself automatically whenever code is
pushed to GitHub. Running it locally is only useful if you want to preview changes
on your own machine before they go live, or if you're working with Claude Code on a
new laptop.

## 1. Install Node.js

Download the **LTS** version from [nodejs.org](https://nodejs.org) and run the
installer. This gives you Node 18 or later, which is what this project needs.

## 2. Get the code

```bash
git clone https://github.com/bjornngcy-creator/friedd-snake.git
cd friedd-snake
```

## 3. Create your `.env.local` file

This project needs a file called `.env.local` in the project folder with a few
secret values in it. It is never stored in GitHub (on purpose, for security), so you
have to create it yourself on each new machine.

Copy `.env.local.example` to a new file named `.env.local`, then fill in each value:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → your project → **Project Settings → API Keys** → "Project URL" |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page → the `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → the `service_role` key. Keep this one especially private. |
| `FINNHUB_API_KEY` | [finnhub.io](https://finnhub.io) dashboard → your API key |
| `SUPABASE_DB_PASSWORD` | The database password you saved when you first set up the Supabase project (Supabase dashboard → **Project Settings → Database** if you need to reset it) |

## 4. Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## That's it

You do not need to deploy anything yourself. Every push to the `main` branch on
GitHub automatically updates the live site at https://friedd-snake.vercel.app within
a minute or two. Running it locally (steps above) is optional — it's only for
previewing before something goes live, or for a developer/Claude Code to work on it.

For monthly operations (rotating the student access code) and everything else,
see `README.md` in the project root.
