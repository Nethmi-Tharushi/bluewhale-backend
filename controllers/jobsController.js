const Job = require('../models/Job');
const User = require('../models/User');

// For CRM dashboard — get all jobs including expired
const getAllJobs = async (req, res) => {
  try {
    const jobs = await Job.find().sort({ postedAt: -1 }).lean();
    res.json(jobs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch all jobs', error: err.message });
  }
};

// Get all jobs
const getJobs = async (req, res) => {
  const { country, type, search } = req.query;
  const filter = {
    expiringAt: { $gte: new Date() }
  };

  if (country) filter.country = country;
  if (type) filter.type = type;
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { company: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }

  try {
    const jobs = await Job.find(filter).sort({ postedAt: -1 }).lean();
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get single job
const getJobById = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (job) {
      res.json(job);
    } else {
      res.status(404).json({ message: 'Job not found' });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Create job (Admin only)
const createJob = async (req, res) => {
  try {
    console.log("👉 Authenticated Admin:", req.admin); // Debug

    if (!req.admin) {
      return res.status(401).json({ message: "Not authorized, no admin found" });
    }

    const job = new Job({
      ...req.body,
      postedBy: req.admin._id, // ✅ Use req.admin instead of req.user
    });

    const createdJob = await job.save();
    res.status(201).json(createdJob);
  } catch (err) {
    console.error("Create Job Error:", err.message);
    res.status(400).json({ message: err.message });
  }
};


// Apply for job
const applyForJob = async (req, res) => {
  try {
    const jobId = req.params.id;
    const userId = req.user._id;

    // Fetch user
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Fetch job
    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });

    // Check if already applied
    const alreadyApplied = user.appliedJobs.some(
      jobItem => jobItem.jobId.toString() === jobId.toString()
    );

    if (alreadyApplied) {
      return res.status(200).json({ message: "You have already applied to this job" });
    }

    // Add to user's appliedJobs
    user.appliedJobs.push({
      jobId: job._id,
      status: "Applied",
      appliedAt: new Date()
    });

    // Add to job applicants (optional)
    job.applicants.push({
      userId: user._id,
      status: "Applied",
      appliedAt: new Date()
    });

    // Save both
    await user.save();
    await job.save();

    res.status(200).json({ message: "Job applied successfully" });
  } catch (error) {
    console.error("Error applying for job:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};


// DELETE /api/jobs/:id
const deleteJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    await job.deleteOne();  // safer than remove()
    res.json({ message: 'Job deleted successfully' });
  } catch (err) {
    console.error('Delete job error:', err);
    res.status(500).json({ message: 'Server error while deleting job' });
  }
};


// PUT /api/jobs/:id
const updateJob = async (req, res) => {
  try {
    const updatedJob = await Job.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!updatedJob) {
      return res.status(404).json({ message: 'Job not found' });
    }

    res.json(updatedJob);
  } catch (err) {
    console.error('Update failed:', err);
    res.status(500).json({ message: 'Failed to update job.' });
  }
};

// POST /api/jobs/:id/inquiry
const makeInquiry = async (req, res) => {
  try {
    const { email, heading, subject, message } = req.body;

    // Check if job exists
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    // Prevent duplicate inquiry from same email
    const alreadyInquired = job.inquiries.some(
      (inq) => inq.email.toLowerCase() === email.toLowerCase()
    );
    if (alreadyInquired) {
      return res.status(400).json({ message: 'You have already inquired about this job.' });
    }

    // Push inquiry without triggering full validation
    await Job.updateOne(
      { _id: req.params.id },
      {
        $push: {
          inquiries: {
            email,
            heading: Array.isArray(heading) ? heading : [heading],
            subject,
            message,
            status: 'Pending',
            appliedAt: new Date(),
          },
        },
      }
    );

    res.status(201).json({ message: 'Inquiry submitted successfully' });
  } catch (err) {
    console.error('Inquiry error:', err);
    res.status(500).json({ message: 'Server error while submitting inquiry' });
  }
};


module.exports = {
  getJobs,
  getJobById,
  createJob,
  applyForJob,
  updateJob,
  deleteJob,
  makeInquiry,
  getAllJobs
};
