const database = db.getSiblingDB(process.env.MONGO_DATABASE);
database.createUser({
  user: process.env.MONGO_APP_USERNAME,
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: "readWrite", db: process.env.MONGO_DATABASE }],
});
