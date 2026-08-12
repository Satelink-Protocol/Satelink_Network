FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json .npmrc ./
RUN npm install
COPY . .
EXPOSE 8080
CMD ["npm", "start", "--workspace=@satelink/reconciler"]
