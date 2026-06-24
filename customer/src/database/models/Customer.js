const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const CustomerSchema = new Schema(
  {
    email: String,
    password: String,
    salt: String,
    phone: String,
    address: [{ type: Schema.Types.ObjectId, ref: 'address', require: true }],
    cart: [
      {
        product: {
          _id: { type: String, required: true },
          name: { type: String },
          desc: { type: String },
          banner: { type: String },
          type: { type: String },
          unit: { type: Number },
          price: { type: Number },
          available: { type: Boolean },
          suplier: { type: String },
        },
        unit: { type: Number, require: true },
      },
    ],
    wishlist: [
      {
        _id: { type: String, required: true },
        name: { type: String },
        desc: { type: String },
        banner: { type: String },
        price: { type: Number },
        available: { type: Boolean },
      },
    ],
    orders: [
      {
        _id: { type: String, required: true },
        amount: { type: String },
        date: { type: Date, default: Date.now() },
      },
    ],
  },
  {
    toJSON: {
      transform(doc, ret) {
        delete ret.password;
        delete ret.salt;
        delete ret.__v;
      },
    },
    timestamps: true,
  },
);

module.exports = mongoose.model('customer', CustomerSchema);
