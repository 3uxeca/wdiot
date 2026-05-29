-- Read the active (frontmost) application + its focused window title for
-- WDIOT capture (plan B2, app-source). Uses System Events, which requires
-- macOS Accessibility permission.
--
-- Emits a single line, fields separated by U+001F (unit separator):
--   <appName>␟<bundleId>␟<windowTitle>
-- `bundleId` and `windowTitle` may be empty (some processes expose neither).

set fs to (ASCII character 31) -- U+001F unit separator

tell application "System Events"
  set frontProc to first application process whose frontmost is true
  set appName to name of frontProc
  set bundleId to ""
  try
    set bundleId to bundle identifier of frontProc
  end try
  set windowTitle to ""
  try
    set windowTitle to name of front window of frontProc
  end try
end tell

return appName & fs & bundleId & fs & windowTitle
