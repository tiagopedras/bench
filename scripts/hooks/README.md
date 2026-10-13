# Commit guard

Before a commit goes through, `scripts/check-private.sh` looks at the lines you have staged. It stops the commit if it finds a word from your private list, or a secret such as an API key (this second check needs [gitleaks](https://github.com/gitleaks/gitleaks) installed, and is skipped with a note if it is not).

To switch it on:

1. Copy `scripts/private-words.example.txt` to `data/private-words.txt`. The `data/` folder is gitignored, so the list never leaves your machine.
2. Fill it in, one word per line: your surname, your employer, colleagues' first names.
3. Run `scripts/install-hooks.sh`. It sets `core.hooksPath` to `scripts/hooks` and can be run again safely.

To check everything already tracked, run `scripts/check-private.sh --all`. Each hit is printed as file, line and the matched word. If the list is missing, the word check is skipped with a note.

If a word is blocked by mistake, `git commit --no-verify` lets that one commit through.
