# Stage 1: Builder
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package.json ./
COPY package-lock.json* ./

# Copy Prisma schema and config BEFORE npm install
COPY prisma/ ./prisma/
COPY prisma.config.ts ./

# Install all dependencies (including devDependencies for building)
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Generate Prisma Client (Prisma 6.x uses binary engine by default)
RUN npx prisma generate --schema=./prisma/schema.prisma

# Copy source code and TypeScript config
COPY src/ ./src/
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

# Stage 2: Runner
FROM node:20-alpine AS runner

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# Copy package files
COPY package.json ./
COPY package-lock.json* ./

# Copy Prisma files BEFORE npm install
COPY prisma/ ./prisma/
COPY prisma.config.ts ./

# Install only production dependencies
RUN if [ -f package-lock.json ]; then npm ci --only=production; else npm install --only=production; fi && \
    npm cache clean --force

# Generate Prisma Client (Prisma 6.x uses binary engine by default)
RUN npx prisma generate --schema=./prisma/schema.prisma

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Change ownership to nodejs user
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check (optional, can be used by orchestrators)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "dist/server.js"]

