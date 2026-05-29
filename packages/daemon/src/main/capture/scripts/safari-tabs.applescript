-- Enumerate Safari tabs for WDIOT capture (plan B2, browser-source).
-- Emits one tab per line, fields separated by U+001F (unit separator):
--   <windowIndex>␟<tabIndex>␟<isActive 0|1>␟<url>␟<title>
-- `isActive` is 1 for the current tab of the frontmost window.
-- Returns an empty string when Safari is not running (no tabs to report).

on joinLines(theList, sep)
  set AppleScript's text item delimiters to sep
  set theText to theList as text
  set AppleScript's text item delimiters to ""
  return theText
end joinLines

if application "Safari" is not running then
  return ""
end if

set fs to (ASCII character 31) -- U+001F unit separator
set out to {}

tell application "Safari"
  set frontWindowId to missing value
  if (count of windows) > 0 then
    set frontWindowId to id of front window
  end if
  set winIndex to 0
  repeat with w in windows
    set winIndex to winIndex + 1
    set isFrontWindow to ((id of w) is equal to frontWindowId)
    set currentTabIndexValue to missing value
    try
      set currentTabIndexValue to index of current tab of w
    end try
    set tabIndex to 0
    repeat with t in tabs of w
      set tabIndex to tabIndex + 1
      set tabUrl to ""
      set tabTitle to ""
      try
        set tabUrl to URL of t
      end try
      try
        set tabTitle to name of t
      end try
      set isActive to "0"
      if isFrontWindow and currentTabIndexValue is not missing value and tabIndex is equal to currentTabIndexValue then
        set isActive to "1"
      end if
      set end of out to ((winIndex as text) & fs & (tabIndex as text) & fs & isActive & fs & tabUrl & fs & tabTitle)
    end repeat
  end repeat
end tell

return my joinLines(out, linefeed)
