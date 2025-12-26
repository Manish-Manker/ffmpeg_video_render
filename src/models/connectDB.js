import mongoose from "mongoose";

export const dbConnection = () => {
  const mongoDBURL = process.env.mongoDBURL;

  if(!mongoDBURL) {
    console.log('Please add the Mongo DB URL in the env file.');
    return;
  }

  mongoose.connect(mongoDBURL);
  const conn = mongoose.connection;

  conn.on('error', err => {
    console.log('Error in connecting the DB', err);
  });
  conn.on('open', () => {
    console.log('DB connected', conn.host, conn.name);
  });
}
