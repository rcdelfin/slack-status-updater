FROM oven/bun:latest

WORKDIR /app

# Copy package.json and bun.lockb
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the application
COPY . .

# Make sure the application runs in production mode
ENV NODE_ENV=production

# Run the application
CMD ["bun", "start"]