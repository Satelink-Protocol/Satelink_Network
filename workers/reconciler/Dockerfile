FROM node:18-alpine
WORKDIR /usr/src/app
COPY . .
RUN npm install --legacy-peer-deps
EXPOSE 8080
ENTRYPOINT ["/bin/sh", "-c", "npm start --workspace=@satelink/reconciler"]
