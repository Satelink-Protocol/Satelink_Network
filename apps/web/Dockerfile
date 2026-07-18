# Use node:20-slim as specified
FROM node:20-slim

# Set WORKDIR
WORKDIR /app

# Safety check for package.json and package-lock.json
# These must exist in the build context (apps/web)
COPY package*.json ./

# Fail build if package.json or node_modules is missing
# (Note: node_modules is ignored by .dockerignore, so we check for package.json here)
RUN if [ ! -f package.json ]; then echo "CRITICAL ERROR: package.json missing in build context"; exit 1; fi

# Install dependencies
RUN npm install --include=dev

# Copy the rest of the files
COPY . .

# Final safety check for node_modules (should be created by npm install)
RUN if [ ! -d node_modules ]; then echo "CRITICAL ERROR: node_modules not created during build"; exit 1; fi

# Expose Next.js default port
EXPOSE 3000

# Run Next.js dev server
CMD ["npm", "run", "dev"]
