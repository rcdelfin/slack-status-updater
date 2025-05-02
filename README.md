# Slack Status Updater

A Bun.js background task that automatically updates your Slack status based on your work schedule, breaks, and holidays.

## Features

- Automatically sets your Slack status to "Active" during work hours and "Away" outside work hours
- Updates status for lunch breaks with appropriate emojis
- Sets special status during short breaks (coffee, tea, etc.)
- Sets status to "Away" on weekends and holidays
- Recognizes holidays and vacation periods
- Daily emoji rotation (same emoji throughout the day, changes daily)
- **Support for multiple Slack workspaces**

## Prerequisites

- [Bun](https://bun.sh/) installed (for local development)
- [Docker](https://www.docker.com/) installed (for containerized deployment)
- Slack API token with appropriate scopes (`users.profile:write`, `users:write`) for each workspace

## Installation

### Local Setup

1. Clone this repository or download the source code
2. Install dependencies:

```bash
bun install
```

3. Edit the `.env` file and add your Slack API tokens:

```
# For single workspace
SLACK_TOKEN=xoxp-your-slack-token-here

# For multiple workspaces
SLACK_TOKEN=xoxp-your-primary-workspace-token
SLACK_TOKEN_WORKSPACE2=xoxp-your-second-workspace-token
SLACK_TOKEN_WORKSPACE3=xoxp-your-third-workspace-token
```

### Docker Setup

1. Create a `.env` file with your Slack tokens:

```
# For single workspace
SLACK_TOKEN=xoxp-your-slack-token-here

# For multiple workspaces
SLACK_TOKEN=xoxp-your-primary-workspace-token
SLACK_TOKEN_WORKSPACE2=xoxp-your-second-workspace-token
SLACK_TOKEN_WORKSPACE3=xoxp-your-third-workspace-token
```

2. Use Docker Compose to build and run the container:

```bash
docker-compose up -d
```

This will build the Docker image and start the container in detached mode, running in the background.

## Configuration

You can customize the app by modifying the configuration in `config.js`:

- `workspaces`: Configure multiple Slack workspaces
- `workHours`: Set your regular work hours
- `lunchBreak`: Set your lunch break time
- `shortBreaks`: Configure short breaks throughout the day
- `holidays`: Add company holidays or personal days off
- `vacationPeriods`: Define vacation periods
- `emojis`: Customize emojis for each status type

### Multiple Workspaces Configuration

To configure multiple workspaces, edit the `workspaces` array in `config.js`:

```javascript
workspaces: [
  {
    name: "Primary Workspace",
    tokenEnvKey: "SLACK_TOKEN" // Name of environment variable with the token
  },
  {
    name: "Secondary Workspace",
    tokenEnvKey: "SLACK_TOKEN_WORKSPACE2"
  },
  // Add more workspaces as needed
]
```

Each workspace requires:
- A unique name for identification in logs
- A `tokenEnvKey` that points to an environment variable containing the Slack token

In the docker-compose.yml file, make sure to set the correct timezone:
```yaml
environment:
  - TZ=Asia/Manila  # Change this to your timezone
  - SLACK_TOKEN=your-token-here
  - SLACK_TOKEN_WORKSPACE2=your-second-token-here
```

## Running the App

### Local Execution

To start the app:

```bash
bun start
```

For development with auto-restart:

```bash
bun dev
```

To build the app:

```bash
bun build
```

### Docker Execution

Start the container in the background:

```bash
docker-compose up -d
```

View logs:

```bash
docker-compose logs -f
```

Stop the container:

```bash
docker-compose down
```

## Running as a Background Service

### Using Docker (Recommended)

Docker provides the easiest way to run the app as a background service with automatic restarts:

```bash
docker-compose up -d
```

The container will automatically restart if it crashes or if the system reboots, thanks to the `restart: always` setting in the docker-compose.yml file.

### On macOS (Alternative)

You can create a launchd service:

1. Create a plist file in `~/Library/LaunchAgents/com.yourname.slackstatusupdater.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.yourname.slackstatusupdater</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/bun</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>/path/to/SlackStatusUpdater</string>
    <key>StandardOutPath</key>
    <string>/path/to/SlackStatusUpdater/logs/out.log</string>
    <key>StandardErrorPath</key>
    <string>/path/to/SlackStatusUpdater/logs/error.log</string>
</dict>
</plist>
```

2. Load the service:

```bash
launchctl load ~/Library/LaunchAgents/com.yourname.slackstatusupdater.plist
```

## How to Get a Slack API Token

1. Go to [Slack API Apps](https://api.slack.com/apps) and create a new app
2. Add the following OAuth scopes to your app:
   - `users.profile:write`
   - `users:write`
3. Install the app to your workspace
4. Copy the OAuth token that starts with `xoxp-`

## License

ISC