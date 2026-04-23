#!/usr/bin/env bash
# Ralph-style loop for recording a coey.dev tour.
#
# Each state is a "tick": take one action, verify win-flag, move on.
# On failure: retry with backoff, up to MAX_TICKS per state.
# No pipeline hangs — every subcommand is wrapped with a hard timeout.
# Every tick prints a pulse line so the user can see forward motion.
#
# State machine:
#   OPEN     → on coey.dev homepage
#   RECORD   → recording started
#   NAV_PROJ → on /projects
#   SCROLL   → scrolled down to show list
#   PICK     → landed on /projects/unsurf
#   STOP     → recording saved
#   DONE     → mp4 produced
#
# Win flag per state is a DOM/URL check; we only advance when it's true.

set -u
OUT=~/cloudflare/recordings/coey-tour
mkdir -p "$(dirname "$OUT")"
PROFILE=~/.cmux-browser
TIMEOUT=${TIMEOUT:-10}
MAX_TICKS=${MAX_TICKS:-6}
AB="agent-browser --profile $PROFILE"   # headless — no focus steal

pulse() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }

# Hard-timeout wrapper: if a CLI call blocks, we kill it and continue.
# perl instead of `timeout` (not on macOS by default).
run() {
  local label="$1"; shift
  perl -e '
    use strict; use warnings;
    my $timeout = shift;
    my $pid = fork();
    if ($pid == 0) { exec(@ARGV); exit 127; }
    local $SIG{ALRM} = sub { kill 9, $pid; exit 124; };
    alarm $timeout;
    waitpid($pid, 0);
    exit($? >> 8);
  ' -- "$TIMEOUT" "$@"
  local rc=$?
  if [ $rc -eq 124 ]; then
    pulse "TIMEOUT ($TIMEOUT s) on $label"
  fi
  return $rc
}

# Evaluate JS in page, echo result (may be empty).
eval_js() { run "eval" $AB eval "$1" 2>/dev/null; }

# Win-flag checks (each prints nonempty on success).
check_home()    { eval_js "/Jordan Coeyman/.test(document.title) ? 'ok' : ''"; }
check_projects(){ eval_js "location.pathname === '/projects' ? 'ok' : ''"; }
check_unsurf()  { eval_js "/\\/projects\\/unsurf/.test(location.pathname) ? 'ok' : ''"; }
check_scrolled(){ eval_js "window.scrollY > 1500 ? 'ok' : ''"; }

tick() {
  local state="$1" action="$2" check="$3"
  for i in $(seq 1 $MAX_TICKS); do
    pulse "$state tick $i/$MAX_TICKS: $action"
    eval "$action" >/dev/null 2>&1
    local ok
    ok=$($check | tr -d '"\r\n ')
    if [ "$ok" = "ok" ]; then
      pulse "$state ✓"
      return 0
    fi
    sleep 1
  done
  pulse "$state ✗ (gave up)"
  return 1
}

pulse "RESET: closing any running agent-browser"
run "close" agent-browser close >/dev/null 2>&1 || true
sleep 1

pulse "OPEN: homepage"
tick OPEN       "run open $AB open https://coey.dev >/dev/null" check_home || exit 1

# Wait for Google Fonts to finish loading before we start the recorder,
# otherwise the video captures the `font-display: swap` fallback face.
pulse "FONTS: wait for document.fonts.ready"
run "fonts-ready" $AB wait --fn 'document.fonts.ready.then(() => true)' >/dev/null 2>&1
# Belt-and-suspenders: check ready state directly too.
check_fonts(){ eval_js "document.fonts.status === 'loaded' ? 'ok' : ''"; }
tick FONTS      "true" check_fonts || pulse "fonts.status never reached 'loaded' — continuing anyway"

pulse "RECORD: start"
run "rec-start" $AB record start "$OUT.webm" >/dev/null 2>&1

pulse "NAV_PROJ: click Projects nav"
# Prefer href selector; fall back to direct navigation.
tick NAV_PROJ   "run click $AB click 'a[href=\"/projects\"]' 2>/dev/null || run nav $AB open https://coey.dev/projects" check_projects || exit 1

pulse "SCROLL: down 2400"
tick SCROLL     "run scroll $AB scroll down 2400" check_scrolled || exit 1

pulse "WAIT: 800ms to let the scroll settle on camera"
run "wait" $AB wait 800 >/dev/null 2>&1
sleep 0.8

pulse "PICK: navigate directly to unsurf (avoid ambiguous text match)"
tick PICK       "run nav $AB open https://coey.dev/projects/unsurf" check_unsurf || exit 1

pulse "STOP: recording"
run "rec-stop" $AB record stop >/dev/null 2>&1
sleep 1

if [ -s "$OUT.webm" ]; then
  pulse "DONE: webm written ($(du -h "$OUT.webm" | cut -f1))"
else
  pulse "FAIL: webm missing"
  exit 1
fi

pulse "MP4: transcode"
ffmpeg -y -i "$OUT.webm" -c:v libx264 -crf 22 -preset fast -movflags +faststart "$OUT.mp4" >/dev/null 2>&1
pulse "MP4: $(du -h "$OUT.mp4" | cut -f1)"
echo "$OUT.mp4"
