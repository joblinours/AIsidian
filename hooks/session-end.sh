#!/usr/bin/env bash
# Claude Code SessionEnd hook: captures durable knowledge of the session into
# the AIsidian vault. It extracts the conversation text and starts a detached,
# headless `claude -p` that applies the capture filter and writes through the
# AIsidian MCP server (configured in Claude Code as "aisidian").
#
# Environment:
#   AISIDIAN_MCP_NAME       MCP server name in Claude Code (default: aisidian)
#   AISIDIAN_CAPTURE_MODEL  model alias for the capture (default: sonnet)
#   AISIDIAN_MIN_TURNS      minimum user messages to consider a capture (default: 3)
#   AISIDIAN_MAX_CHARS      transcript characters sent to the capture (default: 150000)
#   AISIDIAN_CAPTURE_DISABLED=1  disables the hook
set -euo pipefail

# Never capture the capture session itself.
[[ "${AISIDIAN_CAPTURE_CHILD:-}" == "1" || "${AISIDIAN_CAPTURE_DISABLED:-}" == "1" ]] && exit 0
command -v jq >/dev/null && command -v claude >/dev/null || exit 0

mcp=${AISIDIAN_MCP_NAME:-aisidian}
model=${AISIDIAN_CAPTURE_MODEL:-sonnet}
min_turns=${AISIDIAN_MIN_TURNS:-3}
max_chars=${AISIDIAN_MAX_CHARS:-150000}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cache=${XDG_CACHE_HOME:-$HOME/.cache}/aisidian
mkdir -p "$cache"

input=$(cat)
session_id=$(jq -r '.session_id // empty' <<<"$input")
transcript=$(jq -r '.transcript_path // empty' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")
[[ -n "$session_id" && -f "$transcript" ]] || exit 0

# Already handled (hook re-run): the server also deduplicates via capture_id.
marker="$cache/done-$session_id"
[[ -e "$marker" ]] && exit 0

# Conversation text only: user prompts and assistant text, no tool results.
conversation=$(jq -r '
  select(.type == "user" or .type == "assistant") | select(.isSidechain != true) |
  .message as $m |
  ( if ($m.content | type) == "string" then $m.content
    else ([$m.content[]? | select(.type == "text") | .text] | join("\n")) end ) as $t |
  select(($t | length) > 0) |
  "### " + (if .type == "user" then "Utilisateur" else "Claude" end) + "\n" + $t + "\n"
' "$transcript" 2>/dev/null || true)

user_turns=$(jq -r 'select(.type == "user" and (.message.content | type) == "string") | 1' "$transcript" 2>/dev/null | wc -l)
(( user_turns >= min_turns )) || exit 0
[[ -n "$conversation" ]] || exit 0

# Keep the end of long sessions.
if (( ${#conversation} > max_chars )); then conversation="[…début tronqué…]
${conversation: -$max_chars}"; fi

prompt_file="$cache/capture-$session_id.md"
{
  sed -e "s|{{SESSION_ID}}|$session_id|g" -e "s|{{CWD}}|${cwd//|/\\|}|g" -e "s|{{MCP}}|$mcp|g" "$here/capture-prompt.md"
  printf '\n<transcript>\n%s\n</transcript>\n' "$conversation"
} > "$prompt_file"
touch "$marker"

tools="mcp__${mcp}__search mcp__${mcp}__find_duplicates mcp__${mcp}__read_note mcp__${mcp}__list_tags mcp__${mcp}__create_note mcp__${mcp}__append_to_note"

# Detached: the session closes immediately, the capture runs in the background.
(
  cd "$cache"
  AISIDIAN_CAPTURE_CHILD=1 nohup claude -p --model "$model" --allowedTools "$tools" \
    < "$prompt_file" > "$cache/capture-$session_id.log" 2>&1
  rm -f "$prompt_file"
) </dev/null >/dev/null 2>&1 &
disown || true
exit 0
