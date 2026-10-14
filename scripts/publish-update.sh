#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || -z "$1" ]]; then
  printf '%s\n' '用法：bash scripts/publish-update.sh "本次更新说明"' >&2
  exit 2
fi
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf '%s\n' '当前目录尚未初始化 Git。请先设置用户指定的 GitHub 仓库。' >&2
  exit 1
fi
git remote get-url origin >/dev/null
branch="$(git symbolic-ref --quiet --short HEAD)"
bash scripts/check-mobile.sh
git add -A -- .
while IFS= read -r -d '' staged_path; do
  case "/$staged_path" in
    */.env.example) continue ;;
    */.env|*/.env.*|*/*.sqlite3|*/*.sqlite3-*|*/*.sqlite3.*|*/artifacts/*|*/__pycache__/*|*/.asset_logo_cache/*)
      printf '%s\n' '暂存区包含运行数据或敏感文件，已停止发布；请检查暂存文件。' >&2
      exit 1
      ;;
  esac
done < <(git diff --cached --name-only -z)
if ! git diff --cached --quiet; then
  git commit -m "$1"
fi
git push --set-upstream origin "$branch"
