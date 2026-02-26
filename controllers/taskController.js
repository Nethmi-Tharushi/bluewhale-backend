const Document = require("../models/Document");
const Task = require('../models/Task');
const User = require('../models/User');

// Get tasks for candidate (both B2C and B2B managed)
const getTasks = async (req, res) => {
  try {
    let candidateId = req.user._id;
    let isManagedView = false;

    // Handle managed candidate view
    if (req.query.managedCandidateId) {
      const agent = await User.findById(req.user._id);
      const managedCandidate = agent.managedCandidates.id(req.query.managedCandidateId);

      if (!managedCandidate) {
        return res.status(404).json({ message: "Managed candidate not found" });
      }

      // For B2B managed candidates
      candidateId = req.query.managedCandidateId;
      isManagedView = true;

      const tasks = await Task.find({
        candidateType: 'B2B',
        managedCandidateId: candidateId,
        agent: req.user._id
      })
        .populate('assignedBy', 'name email')
        .populate('relatedJob', 'title company')
        .sort({ createdAt: -1 });

      return res.json({ tasks });
    } else {
      // For B2C candidates
      const tasks = await Task.find({
        candidateType: 'B2C',
        candidate: candidateId
      })
        .populate('assignedBy', 'name email')
        .populate('relatedJob', 'title company')
        .sort({ createdAt: -1 });

      return res.json({ tasks });
    }
  } catch (err) {
    console.error("Error fetching tasks:", err);
    res.status(500).json({ message: err.message });
  }
};

// GET ALL TASKS FOR MAIN ADMIN
const getAdminTasks = async (req, res) => {
  try {
    if (!req.admin || req.admin.role !== "MainAdmin") {
      return res.status(403).json({ message: "Access denied" });
    }

    let tasks = await Task.find()
      .populate("assignedBy", "name email role")
      .populate("candidate", "name email")
      .populate("agent", "name email companyName")
      .populate("relatedJob", "title company")
      .sort({ createdAt: -1 });

    const populatedTasks = [];

    for (let task of tasks) {
      task = task.toObject();

      if (task.candidateType === "B2B" && task.agent && task.managedCandidateId) {
        
        const agent = await User.findById(task.agent._id);

        if (agent && Array.isArray(agent.managedCandidates)) {
          const managed = agent.managedCandidates.find(
            (mc) => mc._id.toString() === task.managedCandidateId.toString()
          );

          if (managed) {
            task.candidateName = managed.name;
          }
        }
      } else {
        // B2C
        task.candidateName = task.candidate?.name || "N/A";
      }

      populatedTasks.push(task);
    }

    res.json({ tasks: populatedTasks });

  } catch (err) {
    console.error("Admin Task Fetch Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Create new task (Main Admin only - can create for anyone)
const createTask = async (req, res) => {
  try {
    // Only MainAdmin can access this
    if (req.admin.role !== 'MainAdmin') {
      return res.status(403).json({ message: "Only Main Admin can create tasks" });
    }

    const {
      title,
      description,
      type,
      priority,
      dueDate,
      candidateType,
      candidate, 
      managedCandidateId, 
      agent, 
      requiredDocument,
      relatedJob
    } = req.body;

    // Validate based on candidate type
    if (candidateType === 'B2C' && !candidate) {
      return res.status(400).json({ message: "Candidate ID required for B2C tasks" });
    }

    if (candidateType === 'B2B' && (!managedCandidateId || !agent)) {
      return res.status(400).json({ message: "Managed candidate ID and agent ID required for B2B tasks" });
    }

    const taskData = {
      title,
      description,
      type,
      priority: priority || 'medium',
      dueDate,
      candidateType,
      assignedBy: req.admin._id
    };

        if (requiredDocument && requiredDocument.trim() !== '') {
      taskData.requiredDocument = requiredDocument;
    }
    
    if (relatedJob && relatedJob.trim() !== '' && mongoose.Types.ObjectId.isValid(relatedJob)) {
      taskData.relatedJob = relatedJob;
    }

    // Add candidate-specific data
    if (candidateType === 'B2C') {
      taskData.candidate = candidate;
    } else if (candidateType === 'B2B') {
      taskData.managedCandidateId = managedCandidateId;
      taskData.agent = agent;
    }

    const task = await Task.create(taskData);

    const populatedTask = await Task.findById(task._id)
      .populate('assignedBy', 'name email')
      .populate('relatedJob', 'title company')
      .populate('candidate', 'name email')
      .populate('agent', 'name email companyName');

    res.status(201).json(populatedTask);
  } catch (err) {
    console.error("Error creating task:", err);
    res.status(500).json({ message: err.message });
  }
};

// Update task (Main Admin only)
const updateTask = async (req, res) => {
  try {
    if (req.admin.role !== 'MainAdmin') {
      return res.status(403).json({ message: "Only Main Admin can update tasks" });
    }

    const { requiredDocument, relatedJob, ...updateData } = req.body;

    const cleanData = { ...updateData };
    
    if (requiredDocument !== undefined) {
      cleanData.requiredDocument = requiredDocument.trim() !== '' ? requiredDocument : null;
    }
    
    if (relatedJob !== undefined) {
      cleanData.relatedJob = relatedJob.trim() !== '' && mongoose.Types.ObjectId.isValid(relatedJob) 
        ? relatedJob 
        : null;
    }

    const task = await Task.findByIdAndUpdate(
      req.params.id,
      cleanData, 
      { new: true }
    ).populate('assignedBy', 'name email')
     .populate('relatedJob', 'title company')
     .populate('candidate', 'name email')
     .populate('agent', 'name email companyName');

    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    res.json(task);
  } catch (err) {
    console.error("Error updating task:", err);
    res.status(500).json({ message: err.message });
  }
};

// Delete task (Main Admin only)
const deleteTask = async (req, res) => {
  try {
    // Only MainAdmin can access this
    if (req.admin.role !== 'MainAdmin') {
      return res.status(403).json({ message: "Only Main Admin can delete tasks" });
    }

    const task = await Task.findByIdAndDelete(req.params.id);

    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    res.json({ message: "Task deleted successfully" });
  } catch (err) {
    console.error("Error deleting task:", err);
    res.status(500).json({ message: err.message });
  }
};

// Mark task as complete (Candidate/Agent can do this)
const markTaskComplete = async (req, res) => {
  try {
    const { completionNotes, completionFiles } = req.body;
    const taskId = req.params.id;
    const user = req.user; 

    const existingTask = await Task.findById(taskId);
    if (!existingTask) {
      return res.status(404).json({ message: "Task not found" });
    }

    const updateData = {
      status: 'Completed',
      completedAt: new Date(),
      completionNotes,
      completionFiles: completionFiles || []
    };

    const task = await Task.findByIdAndUpdate(
      taskId,
      updateData,
      { new: true }
    )
    .populate('assignedBy', 'name email')
    .populate('relatedJob', 'title company')
    .populate('candidate', 'name email')
    .populate('agent', 'name email companyName');

    // If it's a document upload task, save to documents
    if (task.type === 'Document Upload' && completionFiles && completionFiles.length > 0) {
      const fileMappings = {
        'cv': 'cv',
        'passport': 'passport', 
        'picture': 'photo',
        'drivingLicense': 'drivingLicense'
      };

      const documentType = fileMappings[task.requiredDocument] || 'other';

      // Determine if B2C or B2B
      if (task.candidateType === 'B2C') {
        // Save to B2C Document collection
        const documentPromises = completionFiles.map(file => {
          return Document.create({
            user: task.candidate,
            type: documentType,
            url: file.fileUrl, 
            originalName: file.fileName,
            size: file.size || 0,
            mimeType: file.mimeType || 'application/octet-stream',
            cloudinaryId: file.publicId || file.fileName,
            uploadedAt: new Date(),
            fromTask: taskId
          });
        });

        await Promise.all(documentPromises);

      } else if (task.candidateType === 'B2B') {
        //  Save to B2B agent's managed candidate subdocument
        const agent = await User.findById(task.agent);
        if (agent) {
          const managedCandidate = agent.managedCandidates.id(task.managedCandidateId);
          if (managedCandidate) {
            const b2bFileMappings = {
              'cv': 'CV',
              'passport': 'Passport', 
              'picture': 'Picture',
              'drivingLicense': 'DrivingLicense'
            };

            completionFiles.forEach(file => {
              managedCandidate.documents.push({
                type: b2bFileMappings[task.requiredDocument] || 'Other',
                fileName: file.fileName,
                fileUrl: file.fileUrl,
                uploadedAt: new Date(),
                fromTask: taskId
              });
            });

            await agent.save();
          }
        }
      }
    }

    res.json(task);
  } catch (err) {
    console.error("Error completing task:", err);
    res.status(500).json({ message: err.message });
  }
};

const uploadTaskFiles = async (req, res) => {
    try {
      const files = req.files['files'];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      const uploadedFiles = files.map(file => ({
        fileName: file.originalname,
        fileUrl: file.path,
        size: file.size,
        mimeType: file.mimetype,
        cloudinaryId: file.filename
      }));

      res.json({ files: uploadedFiles });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
}

module.exports = {
  getTasks,
  getAdminTasks,
  createTask,
  updateTask,
  deleteTask,
  markTaskComplete,
  uploadTaskFiles
};