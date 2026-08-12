FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json .npmrc ./
RUN npm install
COPY . .
EXPOSE 8080
ENTRYPOINT ["/bin/sh", "-c", "npm start --workspace=@satelink/reconciler"]
