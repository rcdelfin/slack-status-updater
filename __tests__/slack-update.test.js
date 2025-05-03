import { jest } from "@jest/globals";
import { WebClient } from "@slack/web-api";

// Mock the config
jest.mock("../config.js", () => ({
  default: {
    workspaces: [
      {
        name: "Test Workspace",
        tokenEnvKey: "TEST_SLACK_TOKEN",
      },
      {
        name: "Second Workspace",
        tokenEnvKey: "SECOND_SLACK_TOKEN",
      },
    ],
    emojis: {
      active: [":computer:"],
      away: [":x:"],
      lunch: [":sandwich:"],
      shortBreak: [":coffee:"],
    },
    statusMessages: {
      active: "Active",
      away: "Away",
      lunch: "Lunch Time",
      shortBreak: "Taking a Break",
    },
  },
}));

// Mock console.log to verify debug output
const originalConsoleLog = console.log;
console.log = jest.fn();

// Mock WebClient
jest.mock("@slack/web-api", () => {
  return {
    WebClient: jest.fn().mockImplementation(() => {
      return {
        users: {
          profile: {
            set: jest.fn().mockResolvedValue({ ok: true }),
          },
          setPresence: jest.fn().mockResolvedValue({ ok: true }),
        },
      };
    }),
  };
});

// Mock dotenv
jest.mock("dotenv", () => ({
  config: jest.fn(),
}));

// Import the module under test
const slackModule = await import("../src/index.js");
const { updateSlackStatus } = slackModule;

describe("Slack Status Update Functions", () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup environment variables
    process.env.TEST_SLACK_TOKEN = "test-token";
    process.env.SECOND_SLACK_TOKEN = "second-token";
    delete process.env.DEBUG;
  });

  afterEach(() => {
    // Cleanup
    delete process.env.TEST_SLACK_TOKEN;
    delete process.env.SECOND_SLACK_TOKEN;
    delete process.env.DEBUG;
  });

  afterAll(() => {
    // Restore console.log
    console.log = originalConsoleLog;
  });

  describe("updateSlackStatus", () => {
    it("should update status with correct parameters", async () => {
      // Call the function
      await updateSlackStatus("Test Status", ":test:", 0, false);

      // Get the WebClient mock instance
      const mockWebClient = WebClient.mock.instances[0];
      const mockProfileSet = mockWebClient.users.profile.set;
      const mockSetPresence = mockWebClient.users.setPresence;

      // Verify the profile was set with correct parameters
      expect(mockProfileSet).toHaveBeenCalledTimes(1);

      // Extract the profile from the first call argument
      const profileArg = JSON.parse(mockProfileSet.mock.calls[0][0].profile);

      // Verify the profile properties
      expect(profileArg.status_text).toBe("Test Status");
      expect(profileArg.status_emoji).toBe(":test:");
      expect(profileArg.status_expiration).toBe(0);

      // Verify presence was set to auto
      expect(mockSetPresence).toHaveBeenCalledTimes(1);
      expect(mockSetPresence).toHaveBeenCalledWith({ presence: "auto" });
    });

    it("should set status expiration when provided", async () => {
      // Mock Date.now to return a consistent value
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => 1000000000000); // A fixed timestamp

      // Call the function with expiration
      await updateSlackStatus("Lunch Break", ":sandwich:", 60, false);

      // Get the WebClient mock instance
      const mockWebClient = WebClient.mock.instances[0];
      const mockProfileSet = mockWebClient.users.profile.set;

      // Extract the profile from the first call argument
      const profileArg = JSON.parse(mockProfileSet.mock.calls[0][0].profile);

      // Calculate expected expiration (current time + 60 minutes in seconds)
      const expectedExpiration = Math.floor(Date.now() / 1000) + 60 * 60;

      // Verify expiration was set correctly
      expect(profileArg.status_expiration).toBe(expectedExpiration);

      // Restore original Date.now
      Date.now = originalDateNow;
    });

    it("should set presence to away when specified", async () => {
      // Call the function with setAway = true
      await updateSlackStatus("Away", ":x:", 0, true);

      // Get the WebClient mock instance
      const mockWebClient = WebClient.mock.instances[0];
      const mockSetPresence = mockWebClient.users.setPresence;

      // Verify presence was set to away
      expect(mockSetPresence).toHaveBeenCalledTimes(1);
      expect(mockSetPresence).toHaveBeenCalledWith({ presence: "away" });
    });

    it("should update status for all configured workspaces", async () => {
      // Call the function
      await updateSlackStatus("Test Status", ":test:", 0, false);

      // Verify WebClient was instantiated twice (once for each workspace)
      expect(WebClient).toHaveBeenCalledTimes(2);
      expect(WebClient).toHaveBeenNthCalledWith(1, "test-token");
      expect(WebClient).toHaveBeenNthCalledWith(2, "second-token");

      // Verify profile was set for both workspaces
      expect(
        WebClient.mock.instances[0].users.profile.set
      ).toHaveBeenCalledTimes(1);
      expect(
        WebClient.mock.instances[1].users.profile.set
      ).toHaveBeenCalledTimes(1);

      // Verify presence was set for both workspaces
      expect(
        WebClient.mock.instances[0].users.setPresence
      ).toHaveBeenCalledTimes(1);
      expect(
        WebClient.mock.instances[1].users.setPresence
      ).toHaveBeenCalledTimes(1);
    });

    it("should not send updates to Slack in debug mode", async () => {
      // Enable debug mode
      process.env.DEBUG = "true";

      // Call the function
      await updateSlackStatus("Test Status", ":test:", 0, false);

      // Verify that the Slack APIs were not called
      const mockWebClient = WebClient.mock.instances[0];
      expect(mockWebClient.users.profile.set).not.toHaveBeenCalled();
      expect(mockWebClient.users.setPresence).not.toHaveBeenCalled();

      // Verify debug log was called
      expect(console.log).toHaveBeenCalled();
      const logCall = console.log.mock.calls.find(
        (call) => call[0].includes && call[0].includes("[DEBUG - NOT SENT]")
      );
      expect(logCall).toBeTruthy();
    });

    it("should log with correct format including expiration", async () => {
      await updateSlackStatus("Short Break", ":coffee:", 15, false);

      // Verify that the log includes expiration information
      expect(console.log).toHaveBeenCalled();
      const logCall = console.log.mock.calls.find(
        (call) =>
          call[0].includes && call[0].includes("(expires in 15 minutes)")
      );
      expect(logCall).toBeTruthy();
    });

    it("should handle workspace errors gracefully", async () => {
      // Mock console.error to verify it's called
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      // Mock WebClient to throw an error
      WebClient.mockImplementationOnce(() => {
        return {
          users: {
            profile: {
              set: jest.fn().mockRejectedValue(new Error("API Error")),
            },
            setPresence: jest.fn().mockResolvedValue({ ok: true }),
          },
        };
      });

      // Call the function and expect it not to throw
      await expect(
        updateSlackStatus("Test", ":test:", 0, false)
      ).resolves.not.toThrow();

      // Verify error was logged
      expect(consoleSpy).toHaveBeenCalled();

      // Restore console.error
      consoleSpy.mockRestore();
    });

    it("should continue updating other workspaces if one fails", async () => {
      // First workspace fails, second succeeds
      WebClient
        // First workspace fails
        .mockImplementationOnce(() => ({
          users: {
            profile: {
              set: jest.fn().mockRejectedValue(new Error("API Error")),
            },
            setPresence: jest.fn().mockResolvedValue({ ok: true }),
          },
        }))
        // Second workspace succeeds
        .mockImplementationOnce(() => ({
          users: {
            profile: {
              set: jest.fn().mockResolvedValue({ ok: true }),
            },
            setPresence: jest.fn().mockResolvedValue({ ok: true }),
          },
        }));

      // Mock console.error
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      // Call the function
      await updateSlackStatus("Test Status", ":test:", 0, false);

      // Verify second workspace was updated despite first one failing
      expect(
        WebClient.mock.instances[1].users.profile.set
      ).toHaveBeenCalledTimes(1);
      expect(
        WebClient.mock.instances[1].users.setPresence
      ).toHaveBeenCalledTimes(1);

      // Verify error was logged
      expect(consoleSpy).toHaveBeenCalled();

      // Restore console.error
      consoleSpy.mockRestore();
    });
  });
});
