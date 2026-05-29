-- Enumerate Google Chrome tabs for WDIOT capture (plan B2, browser-source).
-- Emits one tab per line, fields separated by U+001F (unit separator) so
-- titles/URLs containing tabs or pipes are unambiguous:
--   <windowIndex>␟<tabIndex>␟<isActive 0|1>␟<url>␟<title>
-- `isActive` is 1 for the active tab of the frontmost window.
-- Returns an empty string when Chrome is not running (no tabs to report).

on joinLines(theList, sep)
  set AppleScript's text item delimiters to sep
  set theText to theList as text
  set AppleScript's text item delimiters to ""
  return theText
end joinLines

if application "Google Chrome" is not running then
  return ""
end if

set fs to (ASCII character 31) -- U+001F unit separator
set out to {}

tell application "Google Chrome"
  set frontWindowId to missing value
  if (count of windows) > 0 then
    set frontWindowId to id of front window
  end if
  set winIndex to 0
  repeat with w in windows
    set winIndex to winIndex + 1
    set activeTabIdx to active tab index of w
    set isFrontWindow to ((id of w) is equal to frontWindowId)
    set tabIndex to 0
    repeat with t in tabs of w
      set tabIndex to tabIndex + 1
      set tabUrl to ""
      set tabTitle to ""
      try
        set tabUrl to URL of t
      end try
      try
        set tabTitle to title of t
      end try
      set isActive to "0"
      if isFrontWindow and tabIndex is equal to activeTabIdx then
        set isActive to "1"
      end if
      set end of out to ((winIndex as text) & fs & (tabIndex as text) & fs & isActive & fs & tabUrl & fs & tabTitle)
    end repeat
  end repeat
end tell

return my joinLines(out, linefeed)
