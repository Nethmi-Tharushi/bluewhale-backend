// controllers/documentController.js - FINAL VERSION
const Document = require('../models/Document');
const User = require('../models/User');
const cloudinary = require('../config/cloudinary');

const normalizeDocType = (fieldname = '') => {
  const f = String(fieldname).trim();
  if (f === 'CV' || f === 'cv' || f === 'file' || f === 'document') return 'cv';
  if (f === 'picture' || f === 'photo') return 'photo';
  if (f === 'passport') return 'passport';
  if (f === 'drivingLicense') return 'drivingLicense';
  return f;
};

const normalizedFilesMap = (filesInput) => {
  const out = {};
  if (!filesInput) return out;

  if (Array.isArray(filesInput)) {
    filesInput.forEach((file) => {
      const key = normalizeDocType(file.fieldname);
      if (!out[key]) out[key] = [];
      out[key].push(file);
    });
    return out;
  }

  Object.entries(filesInput).forEach(([fieldName, files]) => {
    const key = normalizeDocType(fieldName);
    if (!out[key]) out[key] = [];
    out[key].push(...(files || []));
  });

  return out;
};

// Upload documents for both B2C and B2B
const uploadUserDocuments = async (req, res) => {
  try {
    const { managedCandidateId } = req.body;
    const filesMap = normalizedFilesMap(req.files);
    
    if (managedCandidateId) {
      // Handle B2B managed candidate upload
      const agent = await User.findById(req.user._id);
      const managedCandidate = agent.managedCandidates.id(managedCandidateId);
      
      if (!managedCandidate) {
        return res.status(404).json({ 
          success: false,
          message: "Managed candidate not found" 
        });
      }
      
      // Process file uploads for managed candidate
      const fileMappings = {
        photo: 'Picture',
        passport: 'Passport', 
        drivingLicense: 'DrivingLicense',
        cv: 'CV'
      };
      
      Object.entries(filesMap).forEach(([fieldName, files]) => {
        if (files && files.length > 0) {
          files.forEach(file => {
            managedCandidate.documents.push({
              type: fileMappings[fieldName],
              fileName: file.originalname,
              fileUrl: file.path,
              uploadedAt: new Date()
            });
          });
        }
      });
      
      await agent.save();
      
      // Return updated documents in same format as B2C
      const grouped = {
        photo: managedCandidate.documents.filter(d => d.type === 'Picture'),
        passport: managedCandidate.documents.filter(d => d.type === 'Passport'),
        drivingLicense: managedCandidate.documents.filter(d => d.type === 'DrivingLicense'),
        cv: managedCandidate.documents.filter(d => d.type === 'CV')
      };
      
      return res.status(201).json({ 
        success: true,
        message: `${Object.keys(filesMap).length} document group(s) uploaded successfully`,
        documents: grouped 
      });
    } else {
      // Your existing B2C logic
      const allDocs = [];
      Object.keys(filesMap).forEach(fieldname => {
        filesMap[fieldname].forEach(file => {
          allDocs.push({
            user: req.user._id,
            type: normalizeDocType(file.fieldname),
            url: file.path,
            originalName: file.originalname,
            size: file.size,
            mimeType: file.mimetype,
            cloudinaryId: file.filename
          });
        });
      });

      if (allDocs.length > 0) {
        await Document.insertMany(allDocs);
      } else {
        return res.status(400).json({ 
          success: false,
          message: "No files provided for upload" 
        });
      }

      const docs = await Document.find({ user: req.user._id }).sort({ uploadedAt: -1 });
      const grouped = groupByType(docs);

      res.status(201).json({ 
        success: true,
        message: `${allDocs.length} document(s) uploaded successfully`,
        documents: grouped 
      });
    }
  } catch (err) {
    console.error("Error uploading documents:", err);
    res.status(500).json({ 
      success: false,
      message: "Server error while uploading documents",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// GET documents for both B2C and B2B candidates
const getUserDocuments = async (req, res) => {
  try {
    const { managedCandidateId } = req.query;
    
    if (managedCandidateId) {
      // Handle B2B managed candidate documents
      const agent = await User.findById(req.user._id);
      const managedCandidate = agent.managedCandidates.id(managedCandidateId);
      
      if (!managedCandidate) {
        return res.status(404).json({ message: "Managed candidate not found" });
      }
      
      // Convert managed candidate documents to same format as B2C
      const grouped = {
        photo: managedCandidate.documents?.filter(d => d.type === 'Picture') || [],
        passport: managedCandidate.documents?.filter(d => d.type === 'Passport') || [],
        drivingLicense: managedCandidate.documents?.filter(d => d.type === 'DrivingLicense') || [],
        cv: managedCandidate.documents?.filter(d => d.type === 'CV') || []
      };
      
      return res.json(grouped);
    } else {
      // Your existing B2C logic
      const docs = await Document.find({ user: req.user._id });
      const grouped = groupByType(docs);
      res.json(grouped);
    }
  } catch (err) {
    console.error("Error fetching documents:", err);
    res.status(500).json({ message: "Server error while fetching documents" });
  }
};

// Helper: group documents by type
function groupByType(docs) {
  return docs.reduce((acc, doc) => {
    if (!acc[doc.type]) acc[doc.type] = [];
    acc[doc.type].push(doc);
    return acc;
  }, {});
}

// Delete document for both B2C and B2B
const deleteDocument = async (req, res) => {
  try {
    const { managedCandidateId } = req.query;
    const documentId = req.params.id;
    
    if (managedCandidateId) {
      // Handle B2B managed candidate document deletion
      const agent = await User.findById(req.user._id);
      const managedCandidate = agent.managedCandidates.id(managedCandidateId);
      
      if (!managedCandidate) {
        return res.status(404).json({
          success: false,
          message: "Managed candidate not found"
        });
      }
      
      // Remove document from managed candidate
      managedCandidate.documents = managedCandidate.documents.filter(
        doc => doc._id.toString() !== documentId
      );
      
      await agent.save();
      
      // Return updated documents
      const grouped = {
        photo: managedCandidate.documents.filter(d => d.type === 'Picture'),
        passport: managedCandidate.documents.filter(d => d.type === 'Passport'),
        drivingLicense: managedCandidate.documents.filter(d => d.type === 'DrivingLicense'),
        cv: managedCandidate.documents.filter(d => d.type === 'CV')
      };
      
      return res.json({
        success: true,
        message: 'Document deleted successfully',
        documents: grouped
      });
    } else {
      // Your existing B2C logic
      const userId = req.user._id;
      const document = await Document.findOne({
        _id: documentId,
        user: userId
      });

      if (!document) {
        return res.status(404).json({
          success: false,
          message: 'Document not found'
        });
      }

      if (document.cloudinaryId) {
        try {
          await cloudinary.uploader.destroy(document.cloudinaryId);
        } catch (cloudinaryError) {
          console.error('Error deleting from Cloudinary:', cloudinaryError);
        }
      }

      await Document.findByIdAndDelete(documentId);
      const docs = await Document.find({ user: userId }).sort({ uploadedAt: -1 });
      const grouped = groupByType(docs);

      res.json({
        success: true,
        message: 'Document deleted successfully',
        documents: grouped
      });
    }
  } catch (err) {
    console.error('Error deleting document:', err);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting document',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Get documents by type
const getDocumentsByType = async (req, res) => {
  try {
    const { type } = req.params;
    const allowedTypes = ['photo', 'cv', 'passport', 'drivingLicense'];
    
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document type'
      });
    }

    const documents = await Document.find({
      user: req.user._id,
      type: type
    }).sort({ uploadedAt: -1 });

    res.json({
      success: true,
      documents,
      count: documents.length
    });

  } catch (err) {
    console.error('Error fetching documents by type:', err);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching documents',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

module.exports = {
  uploadUserDocuments,
  getUserDocuments,
  deleteDocument,
  getDocumentsByType
};
