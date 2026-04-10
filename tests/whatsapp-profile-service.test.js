const assert = require("node:assert/strict");
const path = require("path");
const { Writable } = require("node:stream");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const createProfileModelMock = (seedProfiles = [], admins = []) => {
  const store = seedProfiles.map((item) => deepClone(item));

  class FakeProfileDocument {
    constructor(record) {
      Object.assign(this, deepClone(record));
    }

    toObject() {
      return deepClone(this);
    }

    async save() {
      const index = store.findIndex((item) => String(item.singletonKey) === String(this.singletonKey));
      const next = {
        ...deepClone(this),
        updatedAt: "2026-04-08T11:00:00.000Z",
      };
      if (index >= 0) {
        store[index] = next;
      } else {
        store.push(next);
      }
      Object.assign(this, next);
      return this;
    }
  }

  const populateProfile = (record, populateUpdatedBy = false) => {
    if (!record) return null;
    const plain = deepClone(record);
    if (populateUpdatedBy && plain.updatedBy) {
      const admin = admins.find((item) => String(item._id) === String(plain.updatedBy));
      plain.updatedBy = admin
        ? { _id: admin._id, name: admin.name, email: admin.email }
        : null;
    }
    return plain;
  };

  const createQuery = (resolver) => ({
    _populateUpdatedBy: false,
    populate(field) {
      if (field === "updatedBy") {
        this._populateUpdatedBy = true;
      }
      return this;
    },
    async lean() {
      return deepClone(resolver(this._populateUpdatedBy, true));
    },
    then(resolve, reject) {
      return Promise.resolve(resolver(this._populateUpdatedBy, false)).then(resolve, reject);
    },
  });

  return {
    __store: store,
    findOne(filter = {}) {
      return createQuery((populateUpdatedBy, plainOnly) => {
        const record = store.find((item) => String(item.singletonKey) === String(filter.singletonKey));
        if (!record) return null;
        if (plainOnly) return populateProfile(record, populateUpdatedBy);
        return new FakeProfileDocument(populateProfile(record, populateUpdatedBy));
      });
    },
    async create(payload = {}) {
      const record = {
        singletonKey: "default",
        createdAt: "2026-04-08T10:00:00.000Z",
        updatedAt: "2026-04-08T10:00:00.000Z",
        ...deepClone(payload),
      };
      store.push(record);
      return new FakeProfileDocument(record);
    },
  };
};

const createCloudinaryMock = () => {
  const destroyed = [];
  return {
    destroyed,
    uploader: {
      upload_stream(_options, callback) {
        const stream = new Writable({
          write(_chunk, _encoding, next) {
            next();
          },
        });
        stream.on("finish", () => {
          callback(null, {
            secure_url: "https://cdn.example.com/wa-profile-logo.png",
            public_id: "wa_business_profile_logo_123",
            original_filename: "logo",
            bytes: 2048,
          });
        });
        return stream;
      },
      async destroy(publicId) {
        destroyed.push(publicId);
        return { result: "ok" };
      },
    },
  };
};

const loadService = ({ profiles = [], admins = [] } = {}) => {
  const profileModel = createProfileModelMock(profiles, admins);
  const cloudinary = createCloudinaryMock();

  return {
    service: loadWithMocks(path.resolve(__dirname, "../services/whatsappProfileService.js"), {
      "../models/WhatsAppBusinessProfile": profileModel,
      "../config/cloudinary": cloudinary,
      streamifier: {
        createReadStream(buffer) {
          return {
            pipe(destination) {
              destination.end(buffer);
            },
          };
        },
      },
    }),
    store: profileModel.__store,
    cloudinary,
  };
};

module.exports = async () => {
  const admins = [
    {
      _id: "507f1f77bcf86cd799439011",
      name: "Admin User",
      email: "admin@bluewhale.test",
    },
  ];

  const { service, store, cloudinary } = loadService({ profiles: [], admins });

  const initial = await service.getWhatsAppBusinessProfile();
  assert.equal(initial.businessName, "Blue Whale CRM");
  assert.equal(initial.businessType, "Professional Services");
  assert.equal(initial.logoUrl, "");
  assert.equal(store.length, 1);

  const updated = await service.updateWhatsAppBusinessProfile(
    {
      businessName: "Blue Whale CRM",
      businessType: "Professional Services",
      businessDescription: "Manage WhatsApp conversations",
      address: "Colombo",
      email: "support@bluewhalecrm.com",
      website: "https://www.bluewhalecrm.com",
      phone: "+94 70 123 4567",
    },
    { _id: "507f1f77bcf86cd799439011" }
  );
  assert.equal(updated.businessDescription, "Manage WhatsApp conversations");
  assert.equal(updated.email, "support@bluewhalecrm.com");
  assert.equal(updated.updatedBy.name, "Admin User");

  const saved = await service.getWhatsAppBusinessProfile();
  assert.equal(saved.address, "Colombo");
  assert.equal(saved.website, "https://www.bluewhalecrm.com");

  await assert.rejects(
    () =>
      service.updateWhatsAppBusinessProfile(
        {
          email: "bad-email",
        },
        { _id: "507f1f77bcf86cd799439011" }
      ),
    (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, /valid email/i);
      return true;
    }
  );

  await assert.rejects(
    () =>
      service.updateWhatsAppBusinessProfile(
        {
          website: "not-a-url",
        },
        { _id: "507f1f77bcf86cd799439011" }
      ),
    (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, /valid URL/i);
      return true;
    }
  );

  const uploadedLogo = await service.uploadWhatsAppBusinessProfileLogo({
    file: {
      buffer: Buffer.from("image"),
      originalname: "logo.png",
      mimetype: "image/png",
    },
    actor: { _id: "507f1f77bcf86cd799439011" },
  });
  assert.equal(uploadedLogo.logoUrl, "https://cdn.example.com/wa-profile-logo.png");
  assert.equal(uploadedLogo.logoStorageKey, "wa_business_profile_logo_123");

  const removedLogo = await service.deleteWhatsAppBusinessProfileLogo({
    actor: { _id: "507f1f77bcf86cd799439011" },
  });
  assert.equal(removedLogo.logoUrl, "");
  assert.ok(cloudinary.destroyed.includes("wa_business_profile_logo_123"));
};
