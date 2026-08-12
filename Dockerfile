FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json .npmrc ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]