const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/AdminAuth');
const User = require('../models/User');
const Job = require('../models/Job');

// Helper function to get the appropriate savedJobs array
const getSavedJobsArray = (user, managedCandidateId = null) => {
  if (managedCandidateId) {
    // For managed candidate - get their savedJobs array
    const managedCandidate = user.managedCandidates.id(managedCandidateId);
    if (!managedCandidate) {
      throw new Error('Managed candidate not found');
    }
    // Initialize savedJobs array if it doesn't exist
    if (!managedCandidate.savedJobs) {
      managedCandidate.savedJobs = [];
    }
    return managedCandidate.savedJobs;
  } else {
    // For regular B2C candidate
    if (user.userType !== 'candidate') {
      throw new Error('Only candidates can access wishlist directly');
    }
    return user.savedJobs;
  }
};

// @desc    Get saved jobs
// @route   GET /api/wishlist
// @access  Private (Candidate or Agent in managed view)
router.get('/', protect, async (req, res) => {
  try {
    const { managedCandidateId } = req.query;
    
    let user;
    if (managedCandidateId) {
      // Agent getting saved jobs for managed candidate
      user = await User.findById(req.user._id);
      const savedJobs = getSavedJobsArray(user, managedCandidateId);
      
      // Populate the managed candidate's saved jobs
      await user.populate('managedCandidates.savedJobs.jobId');
      
      const validSavedJobs = savedJobs.filter(savedJob => savedJob.jobId);
      
      res.json({
        success: true,
        count: validSavedJobs.length,
        data: validSavedJobs.map(savedJob => ({
          savedAt: savedJob.savedAt,
          job: savedJob.jobId
        }))
      });
    } else {
      // Regular B2C candidate
      user = await User.findById(req.user._id).populate('savedJobs.jobId');
      const validSavedJobs = user.savedJobs.filter(savedJob => savedJob.jobId);

      res.json({
        success: true,
        count: validSavedJobs.length,
        data: validSavedJobs.map(savedJob => ({
          savedAt: savedJob.savedAt,
          job: savedJob.jobId
        }))
      });
    }
  } catch (error) {
    console.error('Get wishlist error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching saved jobs'
    });
  }
});

// @desc    Add job to wishlist
// @route   POST /api/wishlist/:jobId
// @access  Private (Candidate or Agent in managed view)
router.post('/:jobId', protect, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { managedCandidateId } = req.query;

    // Check if job exists
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Get user and appropriate savedJobs array
    const user = await User.findById(req.user._id);
    const savedJobs = getSavedJobsArray(user, managedCandidateId);

    // Check if job is already saved
    const isAlreadySaved = savedJobs.some(
      savedJob => savedJob.jobId.toString() === jobId
    );

    if (isAlreadySaved) {
      return res.status(400).json({
        success: false,
        message: 'Job is already in your wishlist'
      });
    }

    // Add job to savedJobs
    savedJobs.push({
      jobId: jobId,
      savedAt: new Date()
    });

    await user.save();

    res.json({
      success: true,
      message: 'Job added to wishlist successfully',
      data: {
        jobId,
        jobTitle: job.title,
        savedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Add to wishlist error:', error);
    if (error.message === 'Managed candidate not found') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    if (error.message === 'Only candidates can access wishlist directly') {
      return res.status(403).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error adding job to wishlist'
    });
  }
});

// @desc    Remove job from wishlist
// @route   DELETE /api/wishlist/:jobId
// @access  Private (Candidate or Agent in managed view)
router.delete('/:jobId', protect, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { managedCandidateId } = req.query;

    // Get user and appropriate savedJobs array
    const user = await User.findById(req.user._id);
    const savedJobs = getSavedJobsArray(user, managedCandidateId);

    // Find and remove the job
    const savedJobIndex = savedJobs.findIndex(
      savedJob => savedJob.jobId.toString() === jobId
    );

    if (savedJobIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Job not found in wishlist'
      });
    }

    savedJobs.splice(savedJobIndex, 1);
    await user.save();

    res.json({
      success: true,
      message: 'Job removed from wishlist successfully'
    });

  } catch (error) {
    console.error('Remove from wishlist error:', error);
    if (error.message === 'Managed candidate not found') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    if (error.message === 'Only candidates can access wishlist directly') {
      return res.status(403).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error removing job from wishlist'
    });
  }
});

// @desc    Check if job is in wishlist
// @route   GET /api/wishlist/check/:jobId
// @access  Private (Candidate or Agent in managed view)
router.get('/check/:jobId', protect, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { managedCandidateId } = req.query;

    const user = await User.findById(req.user._id);
    const savedJobs = getSavedJobsArray(user, managedCandidateId);

    const isSaved = savedJobs.some(
      savedJob => savedJob.jobId.toString() === jobId
    );

    res.json({
      success: true,
      data: {
        jobId,
        isSaved
      }
    });

  } catch (error) {
    console.error('Check wishlist error:', error);
    if (error.message === 'Managed candidate not found') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    if (error.message === 'Only candidates can access wishlist directly') {
      return res.status(403).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error checking wishlist status'
    });
  }
});

// @desc    Get wishlist summary/stats
// @route   GET /api/wishlist/stats
// @access  Private (Candidate or Agent in managed view)
router.get('/stats', protect, async (req, res) => {
  try {
    const { managedCandidateId } = req.query;
    
    let user;
    let savedJobs;

    if (managedCandidateId) {
      // Agent getting stats for managed candidate
      user = await User.findById(req.user._id);
      const managedCandidate = user.managedCandidates.id(managedCandidateId);
      
      if (!managedCandidate) {
        return res.status(404).json({
          success: false,
          message: 'Managed candidate not found'
        });
      }

      savedJobs = managedCandidate.savedJobs || [];
      await user.populate('managedCandidates.savedJobs.jobId', 'type country postedAt expiringAt');
    } else {
      // Regular B2C candidate
      if (req.user.userType !== 'candidate') {
        return res.status(403).json({
          success: false,
          message: 'Access denied. Only candidates can access wishlist stats directly'
        });
      }

      user = await User.findById(req.user._id)
        .populate('savedJobs.jobId', 'type country postedAt expiringAt');
      savedJobs = user.savedJobs;
    }

    const validSavedJobs = savedJobs.filter(savedJob => savedJob.jobId);

    // Calculate stats
    const stats = {
      totalSaved: validSavedJobs.length,
      byType: {},
      byCountry: {},
      recentlySaved: validSavedJobs.filter(
        savedJob => new Date() - new Date(savedJob.savedAt) < 7 * 24 * 60 * 60 * 1000
      ).length, // Last 7 days
      expiringThisWeek: 0
    };

    validSavedJobs.forEach(savedJob => {
      const job = savedJob.jobId;
      
      // Count by job type
      stats.byType[job.type] = (stats.byType[job.type] || 0) + 1;
      
      // Count by country
      stats.byCountry[job.country] = (stats.byCountry[job.country] || 0) + 1;
      
      // Count expiring this week
      if (job.expiringAt) {
        const daysUntilExpiry = (new Date(job.expiringAt) - new Date()) / (24 * 60 * 60 * 1000);
        if (daysUntilExpiry <= 7 && daysUntilExpiry > 0) {
          stats.expiringThisWeek++;
        }
      }
    });

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Get wishlist stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching wishlist statistics'
    });
  }
});

module.exports = router;