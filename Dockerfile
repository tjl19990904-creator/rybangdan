FROM node:22-slim

WORKDIR /app

# Copy project files
COPY package.json ./
COPY server.js ./
COPY lib/ ./lib/
COPY public/ ./public/

# Create data directory for SQLite
RUN mkdir -p /app/data

# Set environment
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/ranking.db

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
