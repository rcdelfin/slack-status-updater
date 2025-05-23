// Configuration for Slack Status Updater
export default {
  workspaces: [
    {
      name: "Default Workspace",
      tokenEnvKey: "SLACK_TOKEN", // The environment variable key that contains the token for this workspace
    },
    // Add more workspaces as needed, for example:
    // {
    //   name: "Second Workspace",
    //   tokenEnvKey: "SLACK_TOKEN_WORKSPACE2",
    // },
  ],
  workDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  outOfOffice: [
    // { time: "09:00", duration: 60, message: "Out of Office" },
    // { hour: { start: "15:00", end: "18:00" }, message: "Out of Office" },
    // { day: "Saturday", message: "Offline" },
  ],
  workHours: { start: "08:00", end: "16:00" },
  lunchBreak: { start: "12:00", end: "13:00" },
  shortBreaks: [
    { time: "10:30", duration: 15 },
    { time: "15:00", duration: 15 },
  ],
  holidays: [
    { day: "2025-01-01", message: "New Year's Day" },
    { day: "2025-07-04", message: "Independence Day" },
    { day: "2025-12-25", message: "Christmas Day" },
  ],
  vacationPeriods: [{ start: "2025-12-24", end: "2025-12-31" }],
  // Custom status messages for different states
  statusMessages: {
    active: "Active",
    away: "Away",
    lunch: "Lunch Break",
    shortBreak: "Short Break",
    holiday: "On Holiday",
    vacation: "On Vacation",
    weekend: "Weekend Mode",
  },
  emojis: {
    active: [
      ":working-from-home:",
      ":computer:",
      ":desktop_computer:",
      ":technologist:",
      ":workinprogress:",
      ":nerd_face:",
    ],
    away: [":x:", ":door:"],
    lunch: [
      ":sandwich:",
      ":pizza:",
      ":hamburger:",
      ":ramen:",
      ":bento:",
      ":curry:",
      ":sushi:",
    ],
    shortBreak: [":coffee:", ":tea:", ":walking:", ":brain:"],
  },
};
