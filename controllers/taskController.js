const Document = require("../models/Document");
const Task = require('../models/Task');
const User = require('../models/User');
const mongoose = require("mongoose");
const { createMeetingForTask, updateMeetingForTask } = require("../services/taskMeetingService");

const taskDocToB2CDocType = {
  cv: "cv",
  passport: "passport",
  picture: "photo",
  drivingLicense: "drivingLicense",
};

const taskDocToB2BDocType = {
  cv: "CV",
  passport: "Passport",
  picture: "Picture",
  drivingLicense: "DrivingLicense",
};

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
        .populate('relatedMeeting')
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
        .populate('relatedMeeting')
        .sort({ createdAt: -1 });

      return res.json({ tasks });
    }
  } catch (err) {
    console.error("Error fetching tasks:", err);
    res.status(500).json({ message: err.message });
  }
};

const getRelevantTaskDocuments = async (req, res) => {
  try {
    const taskId = req.params.id;
    const task = await Task.findById(taskId);

    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    const userId = req.user._id.toString();

    if (task.candidateType === "B2C") {
      if (!task.candidate || task.candidate.toString() !== userId) {
        return res.status(403).json({ message: "Access denied to this task" });
      }
    } else if (task.candidateType === "B2B") {
      if (!task.agent || task.agent.toString() !== userId) {
        return res.status(403).json({ message: "Access denied to this task" });
      }
    } else {
      return res.status(400).json({ message: "Invalid task candidate type" });
    }

    if (task.type !== "Document Upload") {
      return res.json({ requiredDocument: task.requiredDocument || null, documents: [] });
    }

    const requiredDocument = task.requiredDocument || null;

    if (task.candidateType === "B2C") {
      const query = { user: task.candidate };
      if (requiredDocument && taskDocToB2CDocType[requiredDocument]) {
        query.type = taskDocToB2CDocType[requiredDocument];
      } else {
        query.type = { $in: ["cv", "passport", "photo", "drivingLicense"] };
      }

      const documents = await Document.find(query).sort({ uploadedAt: -1 });
      return res.json({
        requiredDocument,
        documents: documents.map((doc) => ({
          _id: doc._id,
          type: doc.type,
          fileName: doc.originalName,
          fileUrl: doc.url,
          uploadedAt: doc.uploadedAt,
        })),
      });
    }

    const agent = await User.findById(task.agent);
    const managedCandidate = agent?.managedCandidates?.id(task.managedCandidateId);

    if (!managedCandidate) {
      return res.status(404).json({ message: "Managed candidate not found" });
    }

    const allowedTypes = requiredDocument && taskDocToB2BDocType[requiredDocument]
      ? [taskDocToB2BDocType[requiredDocument]]
      : ["CV", "Passport", "Picture", "DrivingLicense"];

    const documents = (managedCandidate.documents || [])
      .filter((doc) => allowedTypes.includes(doc.type))
      .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));

    return res.json({
      requiredDocument,
      documents: documents.map((doc) => ({
        _id: doc._id,
        type: doc.type,
        fileName: doc.fileName,
        fileUrl: doc.fileUrl,
        uploadedAt: doc.uploadedAt,
      })),
    });
  } catch (err) {
    console.error("Error fetching relevant task documents:", err);
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
      .populate("relatedMeeting")
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
      relatedJob,
      meetingDate,
      meetingTime,
      locationType,
      link,
      location,
      meetingStatus,
      notes
    } = req.body;

    // Validate based on candidate type
    if (candidateType === 'B2C' && !candidate) {
      return res.status(400).json({ message: "Candidate ID required for B2C tasks" });
    }

    if (candidateType === 'B2B' && (!managedCandidateId || !agent)) {
      return res.status(400).json({ message: "Managed candidate ID and agent ID required for B2B tasks" });
    }

    if (type === "Document Upload" && (!requiredDocument || !String(requiredDocument).trim())) {
      return res.status(400).json({ message: "Required document type is mandatory for document upload tasks" });
    }

    if (type === "Meeting") {
      if (!meetingDate || !meetingTime || !locationType) {
        return res.status(400).json({ message: "Meeting date, time, and location type are required for meeting tasks" });
      }
    }

    const taskData = {
      title,
      description: type === "Meeting" ? (notes || description || "") : description,
      type,
      priority: priority || 'Medium',
      dueDate: type === "Meeting" ? new Date(`${meetingDate}T${meetingTime}`) : dueDate,
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

    if (type === "Meeting") {
      const meeting = await createMeetingForTask({
        admin: req.admin,
        title,
        candidateType,
        candidate,
        managedCandidateId,
        agent,
        meetingDate,
        meetingTime,
        locationType,
        link,
        location,
        notes: notes || description || "",
      });

      taskData.relatedMeeting = meeting._id;
    }

    const task = await Task.create(taskData);

    const populatedTask = await Task.findById(task._id)
      .populate('assignedBy', 'name email')
      .populate('relatedJob', 'title company')
      .populate('candidate', 'name email')
      .populate('agent', 'name email companyName')
      .populate('relatedMeeting');

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

    const { requiredDocument, relatedJob, meetingDate, meetingTime, locationType, link, location, notes, ...updateData } = req.body;

    const existingTask = await Task.findById(req.params.id);
    if (!existingTask) {
      return res.status(404).json({ message: "Task not found" });
    }

    if (existingTask.relatedMeeting && updateData.type && updateData.type !== 'Meeting') {
      return res.status(400).json({ message: "Meeting tasks cannot be changed to another task type" });
    }

    if (!existingTask.relatedMeeting && updateData.type === 'Meeting') {
      return res.status(400).json({ message: "Convert existing tasks to meetings is not supported. Create a new meeting task instead." });
    }

    const cleanData = { ...updateData };
    
    if (requiredDocument !== undefined) {
      cleanData.requiredDocument = requiredDocument.trim() !== '' ? requiredDocument : null;
    }
    
    if (relatedJob !== undefined) {
      cleanData.relatedJob = relatedJob.trim() !== '' && mongoose.Types.ObjectId.isValid(relatedJob) 
        ? relatedJob 
        : null;
    }

    if (existingTask.relatedMeeting) {
      await updateMeetingForTask({
        meetingId: existingTask.relatedMeeting,
        title: cleanData.title || existingTask.title,
        notes: typeof notes === "string" ? notes : cleanData.description,
        status: cleanData.status === "Cancelled" ? "Canceled" : cleanData.status,
        meetingDate,
        meetingTime,
        locationType,
        link,
        location,
      });

      if (meetingDate && meetingTime) {
        cleanData.dueDate = new Date(`${meetingDate}T${meetingTime}`);
      }

      if (typeof notes === "string") {
        cleanData.description = notes;
      }
    }

    const task = await Task.findByIdAndUpdate(
      req.params.id,
      cleanData, 
      { new: true }
    ).populate('assignedBy', 'name email')
     .populate('relatedJob', 'title company')
     .populate('candidate', 'name email')
     .populate('agent', 'name email companyName')
     .populate('relatedMeeting');

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
    const { completionNotes, completionFiles, selectedExistingDocuments } = req.body;
    const taskId = req.params.id;

    const existingTask = await Task.findById(taskId);
    if (!existingTask) {
      return res.status(404).json({ message: "Task not found" });
    }

    const uploadedCompletionFiles = Array.isArray(completionFiles) ? completionFiles : [];
    const existingDocSelections = Array.isArray(selectedExistingDocuments) ? selectedExistingDocuments : [];

    const normalizedExistingSelections = existingDocSelections
      .filter((doc) => doc && doc.fileUrl)
      .map((doc) => ({
        fileName: doc.fileName || "Existing document",
        fileUrl: doc.fileUrl,
        uploadedAt: new Date(),
        source: "existing",
        documentId: doc._id || doc.documentId || null,
        documentType: doc.type || null,
      }));

    if (
      existingTask.type === "Document Upload" &&
      existingTask.requiredDocument &&
      uploadedCompletionFiles.length === 0 &&
      normalizedExistingSelections.length === 0
    ) {
      return res.status(400).json({
        message: "Please select an existing matching document or upload a new one.",
      });
    }

    const updateData = {
      status: 'Completed',
      completedAt: new Date(),
      completionNotes,
      completionFiles: [...normalizedExistingSelections, ...uploadedCompletionFiles]
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

    // If it's a document upload task, save newly-uploaded files to candidate documents
    if (task.type === 'Document Upload' && uploadedCompletionFiles.length > 0) {
      const documentType = taskDocToB2CDocType[task.requiredDocument] || 'other';

      // Determine if B2C or B2B
      if (task.candidateType === 'B2C') {
        // Save to B2C Document collection
        const documentPromises = uploadedCompletionFiles.map(file => {
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
            uploadedCompletionFiles.forEach(file => {
              managedCandidate.documents.push({
                type: taskDocToB2BDocType[task.requiredDocument] || 'Other',
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
  getRelevantTaskDocuments,
  getAdminTasks,
  createTask,
  updateTask,
  deleteTask,
  markTaskComplete,
  uploadTaskFiles
};
