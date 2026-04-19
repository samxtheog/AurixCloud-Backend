import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as bip39 from 'bip39';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 25565;

app.use(cors({
  origin: '*',
  credentials: false
}));
app.use(express.json());
app.use(cookieParser());

const pterodactylAPI = axios.create({
  baseURL: `${process.env.PTERODACTYL_URL}/api/application`,
  headers: {
    'Authorization': `Bearer ${process.env.PTERODACTYL_API_KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, isAdmin: user.root_admin },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '7d' }
  );
};

// Pricing data helpers
const PRICING_FILE = path.join(__dirname, 'data', 'pricing.json');
const INVOICES_FILE = path.join(__dirname, 'data', 'invoices.json');

const readPricingData = async () => {
  try {
    const data = await fs.readFile(PRICING_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return { categories: [], plans: [] };
  }
};

const writePricingData = async (data) => {
  await fs.writeFile(PRICING_FILE, JSON.stringify(data, null, 2));
};

// Helper to check if plan is trial and get trial days
const getPlanTrialInfo = async (planId) => {
  try {
    const data = await readPricingData();
    const plan = data.plans.find(p => p._id === planId);
    if (plan) {
      return {
        is_trial: plan.is_trial || false,
        trial_days: plan.trial_days || 7
      };
    }
    return { is_trial: false, trial_days: 7 };
  } catch (error) {
    return { is_trial: false, trial_days: 7 };
  }
};

// Helper to check if user already has a trial server
const checkUserTrialServers = async (userId) => {
  try {
    const data = await readInvoicesData();
    const userInvoices = data.invoices.filter(inv => inv.userId === userId);
    
    // Check if any of user's invoices are for trial plans
    for (const invoice of userInvoices) {
      const trialInfo = await getPlanTrialInfo(invoice.planId);
      if (trialInfo.is_trial && invoice.status === 'paid') {
        return true; // User already has a trial server
      }
    }
    return false;
  } catch (error) {
    return false;
  }
};

// Messages data helpers
const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json');

const readMessagesData = async () => {
  try {
    const data = await fs.readFile(MESSAGES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return { messages: [] };
  }
};

const writeMessagesData = async (data) => {
  await fs.writeFile(MESSAGES_FILE, JSON.stringify(data, null, 2));
};

// Simple messages functions
const messagesDB = {
  getAllMessages: async () => {
    const data = await readMessagesData();
    return data.messages;
  },

  getMessageById: async (id) => {
    const data = await readMessagesData();
    return data.messages.find(m => m._id === id);
  },

  getUserMessages: async (userId) => {
    const data = await readMessagesData();
    return data.messages.filter(m => m.user_id == userId); // Use == for loose comparison
  },

  createMessage: async (message) => {
    const data = await readMessagesData();
    const newMessage = {
      _id: generateId(),
      ...message,
      status: 'unread',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    data.messages.push(newMessage);
    await writeMessagesData(data);
    return newMessage;
  },

  updateMessageStatus: async (id, status) => {
    const data = await readMessagesData();
    const index = data.messages.findIndex(m => m._id === id);
    if (index !== -1) {
      data.messages[index].status = status;
      data.messages[index].updated_at = new Date().toISOString();
      await writeMessagesData(data);
      return data.messages[index];
    }
    return null;
  },

  deleteMessage: async (id) => {
    const data = await readMessagesData();
    data.messages = data.messages.filter(m => m._id !== id);
    await writeMessagesData(data);
  }
};

const readInvoicesData = async () => {
  try {
    const data = await fs.readFile(INVOICES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return { invoices: [] };
  }
};

const writeInvoicesData = async (data) => {
  await fs.writeFile(INVOICES_FILE, JSON.stringify(data, null, 2));
};

const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

// Root endpoint - health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'AurixCloud API',
    version: '1.0.0',
    message: 'API is running'
  });
});

// ============================================
// SEO: SITEMAP.XML ROUTE
// ============================================
app.get('/sitemap.xml', (req, res) => {
  const hostname = 'https://aurixcloud.in';
  
  // Define static routes with their SEO properties
  const routes = [
    { url: '/', changefreq: 'daily', priority: '1.0' },
    { url: '/about', changefreq: 'monthly', priority: '0.8' },
    { url: '/contact', changefreq: 'monthly', priority: '0.8' },
    { url: '/services', changefreq: 'weekly', priority: '0.9' },
    { url: '/pricing', changefreq: 'weekly', priority: '0.9' },
    { url: '/login', changefreq: 'monthly', priority: '0.6' },
    { url: '/register', changefreq: 'monthly', priority: '0.6' },
    { url: '/dashboard', changefreq: 'daily', priority: '0.7' },
    { url: '/privacy', changefreq: 'yearly', priority: '0.5' },
    { url: '/terms', changefreq: 'yearly', priority: '0.5' }
  ];

  // Generate XML manually
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  
  routes.forEach(route => {
    xml += '  <url>\n';
    xml += `    <loc>${hostname}${route.url}</loc>\n`;
    xml += `    <changefreq>${route.changefreq}</changefreq>\n`;
    xml += `    <priority>${route.priority}</priority>\n`;
    xml += '  </url>\n';
  });
  
  xml += '</urlset>';

  // Set proper headers
  res.header('Content-Type', 'application/xml');
  res.send(xml);
});

// ============================================
// SEO: ROBOTS.TXT ROUTE
// ============================================
app.get('/robots.txt', (req, res) => {
  const robotsTxt = `# Robots.txt for AurixCloud
User-agent: *
Allow: /
Disallow: /admin
Disallow: /dashboard
Disallow: /api/

# Sitemap
Sitemap: https://aurixcloud.in/sitemap.xml

# Crawl-delay
Crawl-delay: 10
`;

  res.header('Content-Type', 'text/plain');
  res.send(robotsTxt);
});

// Auth Routes
app.post('/api/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body; // identifier can be email or username

    // Get all users from Pterodactyl
    const response = await pterodactylAPI.get('/users');
    const users = response.data.data;

    // Find user by email or username
    const user = users.find(u => 
      u.attributes.email === identifier || u.attributes.username === identifier
    );
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // For demo purposes, we'll accept any password
    // In production, you'd validate against Pterodactyl's auth
    const token = generateToken(user.attributes);

    res.json({
      id: user.attributes.id,
      email: user.attributes.email,
      username: user.attributes.username,
      firstName: user.attributes.first_name,
      lastName: user.attributes.last_name,
      isAdmin: user.attributes.root_admin,
      token
    });
  } catch (error) {
    console.error('Login error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, username, firstName, lastName, password } = req.body;

    // Create user in Pterodactyl
    const userData = {
      email,
      username,
      first_name: firstName,
      last_name: lastName,
      password
    };

    const response = await pterodactylAPI.post('/users', userData);
    const user = response.data.attributes;

    const token = generateToken(user);

    res.status(201).json({
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      isAdmin: user.root_admin,
      token
    });
  } catch (error) {
    console.error('Registration error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: error.response?.data?.errors || 'Registration failed' 
    });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    // Get fresh user data from Pterodactyl
    const response = await pterodactylAPI.get(`/users/${decoded.id}`);
    const user = response.data.attributes;

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      isAdmin: user.root_admin
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

// Admin middleware
const adminOnly = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    if (!decoded.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Admin Routes
app.get('/api/admin/users', adminOnly, async (req, res) => {
  try {
    const response = await pterodactylAPI.get('/users');
    res.json(response.data.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/users/:id', adminOnly, async (req, res) => {
  try {
    const response = await pterodactylAPI.patch(`/users/${req.params.id}`, req.body);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/users/:id', adminOnly, async (req, res) => {
  try {
    await pterodactylAPI.delete(`/users/${req.params.id}`);
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/stats', adminOnly, async (req, res) => {
  try {
    const [usersRes, serversRes] = await Promise.all([
      pterodactylAPI.get('/users'),
      pterodactylAPI.get('/servers')
    ]);

    res.json({
      totalUsers: usersRes.data.data.length,
      activeUsers: usersRes.data.data.filter(u => !u.attributes.suspended).length,
      totalServers: serversRes.data.data.length,
      monthlyRevenue: 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Pricing Categories Routes
app.get('/api/admin/categories', adminOnly, async (req, res) => {
  try {
    const data = await readPricingData();
    res.json({ data: data.categories });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/categories', adminOnly, async (req, res) => {
  try {
    const data = await readPricingData();
    const newCategory = {
      _id: generateId(),
      name: req.body.name,
      description: req.body.description,
      createdAt: new Date().toISOString()
    };
    data.categories.push(newCategory);
    await writePricingData(data);
    res.json({ data: newCategory });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/categories/:id', adminOnly, async (req, res) => {
  try {
    const data = await readPricingData();
    const index = data.categories.findIndex(c => c._id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Category not found' });
    }
    data.categories[index] = {
      ...data.categories[index],
      name: req.body.name,
      description: req.body.description
    };
    await writePricingData(data);
    res.json({ data: data.categories[index] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/categories/:id', adminOnly, async (req, res) => {
  try {
    const data = await readPricingData();
    data.categories = data.categories.filter(c => c._id !== req.params.id);
    data.plans = data.plans.filter(p => p.categoryId !== req.params.id);
    await writePricingData(data);
    res.json({ message: 'Category deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Pricing Plans Routes
app.get('/api/admin/plans', adminOnly, async (req, res) => {
  try {
    const data = await readPricingData();
    res.json({ data: data.plans });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/plans', adminOnly, async (req, res) => {
  try {
    const data = await readPricingData();
    const newPlan = {
      _id: generateId(),
      categoryId: req.body.categoryId,
      name: req.body.name,
      price: req.body.price,
      memory: req.body.memory,
      disk: req.body.disk,
      cpu: req.body.cpu,
      databases: req.body.databases || 0,
      backups: req.body.backups || 0,
      eggId: req.body.eggId || null,
      nodes: req.body.nodes || [],
      createdAt: new Date().toISOString()
    };
    data.plans.push(newPlan);
    await writePricingData(data);
    res.json({ data: newPlan });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/plans/:id', adminOnly, async (req, res) => {
  try {
    const data = await readPricingData();
    const index = data.plans.findIndex(p => p._id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    data.plans[index] = {
      ...data.plans[index],
      ...req.body,
      _id: req.params.id
    };
    await writePricingData(data);
    res.json({ data: data.plans[index] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/plans/:id', adminOnly, async (req, res) => {
  try {
    const data = await readPricingData();
    data.plans = data.plans.filter(p => p._id !== req.params.id);
    await writePricingData(data);
    res.json({ message: 'Plan deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Public pricing routes (no auth required)
app.get('/api/pricing/categories', async (req, res) => {
  try {
    const data = await readPricingData();
    res.json({ data: data.categories });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pricing/plans', async (req, res) => {
  try {
    const data = await readPricingData();
    const categoryId = req.query.categoryId;
    const plans = categoryId 
      ? data.plans.filter(p => p.categoryId === categoryId)
      : data.plans;
    res.json({ data: plans });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all servers
app.get('/api/servers', async (req, res) => {
  try {
    const response = await pterodactylAPI.get('/servers');
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ 
      error: error.response?.data || error.message 
    });
  }
});

// Create a new server
app.post('/api/servers', async (req, res) => {
  try {
    const serverData = {
      name: req.body.name,
      user: req.body.user,
      egg: req.body.egg,
      docker_image: req.body.docker_image,
      startup: req.body.startup,
      environment: req.body.environment,
      limits: {
        memory: req.body.memory,
        swap: req.body.swap || 0,
        disk: req.body.disk,
        io: req.body.io || 500,
        cpu: req.body.cpu
      },
      feature_limits: {
        databases: req.body.databases || 0,
        backups: req.body.backups || 0
      },
      allocation: {
        default: req.body.allocation
      }
    };

    console.log('Creating server with data:', JSON.stringify(serverData, null, 2));
    const response = await pterodactylAPI.post('/servers', serverData);
    res.json(response.data);
  } catch (error) {
    console.error('Pterodactyl API Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ 
      error: error.response?.data?.errors || error.response?.data || error.message 
    });
  }
});

// Get server details
app.get('/api/servers/:id', async (req, res) => {
  try {
    const response = await pterodactylAPI.get(`/servers/${req.params.id}`);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ 
      error: error.response?.data || error.message 
    });
  }
});

// Update server details (name, description)
app.patch('/api/servers/:id/details', async (req, res) => {
  try {
    const response = await pterodactylAPI.patch(`/servers/${req.params.id}/details`, {
      name: req.body.name,
      description: req.body.description
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ 
      error: error.response?.data || error.message 
    });
  }
});

// Update server startup (change egg/nest)
app.patch('/api/servers/:id/startup', async (req, res) => {
  try {
    const response = await pterodactylAPI.patch(`/servers/${req.params.id}/startup`, {
      egg: req.body.egg,
      startup: req.body.startup,
      environment: req.body.environment,
      image: req.body.docker_image || req.body.image,
      skip_scripts: false
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ 
      error: error.response?.data || error.message 
    });
  }
});

// Get user's servers
app.get('/api/user/servers', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    // Get all servers and filter by user
    const response = await pterodactylAPI.get('/servers');
    const userServers = response.data.data.filter(
      server => server.attributes.user === decoded.id
    );
    
    res.json({ data: userServers });
  } catch (error) {
    res.status(error.response?.status || 500).json({ 
      error: error.response?.data || error.message 
    });
  }
});

// Admin: Update server build configuration (limits)
app.patch('/api/admin/servers/:id/build', adminOnly, async (req, res) => {
  try {
    const response = await pterodactylAPI.patch(`/servers/${req.params.id}/build`, {
      limits: req.body.limits,
      feature_limits: req.body.feature_limits
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ 
      error: error.response?.data || error.message 
    });
  }
});

// Admin: Suspend server
app.post('/api/admin/servers/:id/suspend', adminOnly, async (req, res) => {
  try {
    const response = await pterodactylAPI.post(`/servers/${req.params.id}/suspend`);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ 
      error: error.response?.data || error.message 
    });
  }
});

// Admin: Unsuspend server
app.post('/api/admin/servers/:id/unsuspend', adminOnly, async (req, res) => {
  try {
    const response = await pterodactylAPI.post(`/servers/${req.params.id}/unsuspend`);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ 
      error: error.response?.data || error.message 
    });
  }
});

// Delete server
app.delete('/api/servers/:id', async (req, res) => {
  try {
    await pterodactylAPI.delete(`/servers/${req.params.id}`);
    res.json({ message: 'Server deleted successfully' });
  } catch (error) {
    res.status(error.response?.status || 500).json({ 
      error: error.response?.data || error.message 
    });
  }
});

// Get users
app.get('/api/users', async (req, res) => {
  try {
    const response = await pterodactylAPI.get('/users');
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ 
      error: error.response?.data || error.message 
    });
  }
});

// Get nodes
app.get('/api/nodes', async (req, res) => {
  try {
    const response = await pterodactylAPI.get('/nodes');
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ 
      error: error.response?.data || error.message 
    });
  }
});

// Get allocations for a node
app.get('/api/nodes/:id/allocations', async (req, res) => {
  try {
    const response = await pterodactylAPI.get(`/nodes/${req.params.id}/allocations`);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ 
      error: error.response?.data || error.message 
    });
  }
});

// Get all nests and their eggs
app.get('/api/eggs', async (req, res) => {
  try {
    const nestsResponse = await pterodactylAPI.get('/nests');
    const nests = nestsResponse.data.data;
    
    const allEggs = [];
    for (const nest of nests) {
      const eggsResponse = await pterodactylAPI.get(`/nests/${nest.attributes.id}/eggs?include=variables`);
      const eggs = eggsResponse.data.data;
      
      eggs.forEach(egg => {
        allEggs.push({
          id: egg.attributes.id,
          nest_id: nest.attributes.id,
          nest_name: nest.attributes.name,
          name: `${nest.attributes.name} - ${egg.attributes.name}`,
          description: egg.attributes.description,
          docker_image: egg.attributes.docker_image,
          startup: egg.attributes.startup,
          variables: egg.attributes.relationships?.variables?.data?.map(v => ({
            name: v.attributes.name,
            description: v.attributes.description,
            env_variable: v.attributes.env_variable,
            default_value: v.attributes.default_value,
            rules: v.attributes.rules
          })) || []
        });
      });
    }
    
    res.json(allEggs);
  } catch (error) {
    console.error('Error fetching eggs:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ 
      error: error.response?.data || error.message 
    });
  }
});

// Invoice Routes
// Create invoice (when user purchases)
app.post('/api/invoices', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    // Check if this is a trial plan
    const trialInfo = await getPlanTrialInfo(req.body.planId);
    
    // If it's a trial plan, check if user already has a trial server
    if (trialInfo.is_trial) {
      const hasTrialServer = await checkUserTrialServers(decoded.id);
      if (hasTrialServer) {
        return res.status(400).json({ error: 'You can only have one trial server at a time. Trial servers cannot be renewed.' });
      }
    }
    
    const data = await readInvoicesData();
    const newInvoice = {
      _id: generateId(),
      userId: decoded.id,
      userEmail: decoded.email,
      planId: req.body.planId,
      planName: req.body.planName,
      amount: req.body.amount,
      status: trialInfo.is_trial ? 'paid' : 'pending_payment', // Auto-approve trial
      paymentMethod: trialInfo.is_trial ? 'trial' : 'crypto',
      planDetails: req.body.planDetails,
      is_trial: trialInfo.is_trial,
      trial_days: trialInfo.trial_days,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
    };
    
    // If trial, mark as paid and create server immediately
    if (trialInfo.is_trial) {
      newInvoice.paidAt = new Date().toISOString();
      await createServerForInvoice(newInvoice);
    }
    
    data.invoices.push(newInvoice);
    await writeInvoicesData(data);
    res.json({ data: newInvoice });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate crypto payment address
app.post('/api/invoices/:id/generate-address', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const data = await readInvoicesData();
    const invoice = data.invoices.find(inv => inv._id === req.params.id && inv.userId === decoded.id);
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    console.log('Generating payment address for invoice:', invoice._id);

    // Get LTC to USD rate with fallback
    let ltcRate = 100; // Default: $100 = 1 LTC
    try {
      console.log('Fetching LTC rate...');
      const rateResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd', {
        timeout: 5000
      });
      ltcRate = rateResponse.data.litecoin.usd;
      console.log('LTC Rate fetched:', ltcRate);
    } catch (rateError) {
      console.log('Failed to fetch LTC rate, using fallback:', ltcRate);
    }
    
    const ltcAmount = (invoice.amount / ltcRate).toFixed(8);
    console.log('LTC Rate:', ltcRate, 'Amount needed:', ltcAmount);

    // Generate LTC address using BlockCypher
    console.log('Generating LTC address via BlockCypher...');
    const addressResponse = await axios.post(
      `https://api.blockcypher.com/v1/ltc/main/addrs?token=${process.env.BLOCKCYPHER_TOKEN || ''}`
    );
    console.log('Address generated:', addressResponse.data.address);

    invoice.cryptoAddress = addressResponse.data.address;
    invoice.cryptoPrivateKey = addressResponse.data.private;
    invoice.cryptoWif = addressResponse.data.wif; // WIF format for wallet import
    invoice.cryptoAmount = ltcAmount;
    invoice.cryptoRate = ltcRate;
    invoice.status = 'awaiting_payment';
    invoice.updatedAt = new Date().toISOString();

    // Save invoice
    const index = data.invoices.findIndex(inv => inv._id === req.params.id);
    data.invoices[index] = invoice;
    await writeInvoicesData(data);
    console.log('Invoice updated and saved');

    // Start monitoring (don't await, run in background)
    monitorPayment(invoice._id, addressResponse.data.address, ltcAmount);

    res.json({ 
      address: addressResponse.data.address,
      amount: ltcAmount,
      rate: ltcRate,
      wif: addressResponse.data.wif, // WIF private key for wallet import
      expiresAt: invoice.expiresAt
    });
  } catch (error) {
    console.error('Error generating address:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

// Monitor payment function
async function monitorPayment(invoiceId, address, expectedAmount) {
  const startTime = Date.now();
  const timeout = 60 * 60 * 1000; // 1 hour

  const checkPayment = async () => {
    try {
      if (Date.now() - startTime > timeout) {
        // Timeout - mark invoice as expired
        const data = await readInvoicesData();
        const index = data.invoices.findIndex(inv => inv._id === invoiceId);
        if (index !== -1 && data.invoices[index].status === 'awaiting_payment') {
          data.invoices[index].status = 'expired';
          data.invoices[index].updatedAt = new Date().toISOString();
          await writeInvoicesData(data);
        }
        return;
      }

      // Check balance using BlockCypher
      const response = await axios.get(
        `https://api.blockcypher.com/v1/ltc/main/addrs/${address}/balance?token=${process.env.BLOCKCYPHER_TOKEN || ''}`
      );

      const receivedAmount = response.data.balance / 100000000; // Convert from satoshis

      if (receivedAmount >= parseFloat(expectedAmount) * 0.99) { // 1% tolerance
        // Payment received!
        const data = await readInvoicesData();
        const index = data.invoices.findIndex(inv => inv._id === invoiceId);
        
        if (index !== -1) {
          const invoice = data.invoices[index];
          invoice.status = 'paid';
          invoice.paidAt = new Date().toISOString();
          invoice.updatedAt = new Date().toISOString();
          
          // Forward funds to master wallet
          try {
            console.log('Forwarding funds to master wallet...');
            await forwardFundsToMaster(invoice.cryptoAddress, invoice.cryptoPrivateKey, invoice.cryptoWif, receivedAmount);
            console.log('Funds forwarded successfully');
          } catch (forwardError) {
            console.error('Error forwarding funds:', forwardError);
            // Continue anyway - server will still be created
          }
          
          // Create server
          await createServerForInvoice(invoice);
          
          data.invoices[index] = invoice;
          await writeInvoicesData(data);
        }
        return;
      }

      // Check again in 30 seconds
      setTimeout(checkPayment, 30000);
    } catch (error) {
      console.error('Error monitoring payment:', error);
      setTimeout(checkPayment, 30000); // Retry on error
    }
  };

  checkPayment();
}

// Forward funds to master wallet using Tatum
async function forwardFundsToMaster(fromAddress, privateKey, wifKey, amount) {
  try {
    const masterWallet = process.env.MASTER_LTC_ADDRESS;
    if (!masterWallet) {
      console.log('No master wallet configured, skipping fund forwarding');
      return;
    }

    // Calculate fee: 2% of amount or 0.0001 LTC minimum, whichever is greater
    const percentageFee = amount * 0.02; // 2%
    const minimumFee = 0.0001; // 0.0001 LTC minimum
    const fee = Math.max(percentageFee, minimumFee);
    
    const amountToSend = (amount - fee).toFixed(8);

    if (parseFloat(amountToSend) <= 0) {
      console.log('Amount too small to forward after fees');
      return;
    }

    console.log(`Forwarding ${amountToSend} LTC from ${fromAddress} to ${masterWallet} (fee: ${fee.toFixed(8)} LTC)`);

    // Use Tatum API to send transaction - use WIF key (52 chars) not hex private key (64 chars)
    const txData = {
      fromAddress: [
        {
          address: fromAddress,
          privateKey: wifKey // Use WIF format for Tatum
        }
      ],
      to: [
        {
          address: masterWallet,
          value: parseFloat(amountToSend)
        }
      ]
    };

    const response = await axios.post(
      'https://api.tatum.io/v3/litecoin/transaction',
      txData,
      {
        headers: {
          'x-api-key': process.env.TATUM_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Funds forwarded successfully! TX ID:', response.data.txId);
    return response.data.txId;
  } catch (error) {
    console.error('Error forwarding funds:', error.response?.data || error.message);
    // Don't throw - we still want to create the server even if forwarding fails
    console.log('Continuing despite forwarding error...');
  }
}

// Create server for paid invoice
async function createServerForInvoice(invoice) {
  try {
    const plan = invoice.planDetails;
    
    // Get available allocation
    const nodesRes = await pterodactylAPI.get('/nodes');
    const nodes = nodesRes.data.data;
    
    if (nodes.length === 0) {
      throw new Error('No nodes available');
    }

    const node = nodes[0];
    const allocationsRes = await pterodactylAPI.get(`/nodes/${node.attributes.id}/allocations`);
    const allocations = allocationsRes.data.data;
    const availableAllocation = allocations.find(a => !a.attributes.assigned);

    if (!availableAllocation) {
      throw new Error('No available allocations');
    }

    // Get egg
    const eggId = plan.eggId || 1;
    let nestId = 1;
    
    try {
      const nestsResponse = await pterodactylAPI.get('/nests');
      const nests = nestsResponse.data.data;
      
      for (const nest of nests) {
        const eggsResponse = await pterodactylAPI.get(`/nests/${nest.attributes.id}/eggs`);
        const eggs = eggsResponse.data.data;
        if (eggs.find(e => e.attributes.id === eggId)) {
          nestId = nest.attributes.id;
          break;
        }
      }
    } catch (error) {
      console.error('Error finding nest:', error);
    }

    const eggsRes = await pterodactylAPI.get(`/nests/${nestId}/eggs/${eggId}?include=variables`);
    const egg = eggsRes.data.attributes;

    // Build environment variables
    const environment = {};
    if (egg.relationships?.variables?.data) {
      egg.relationships.variables.data.forEach(variable => {
        const varAttrs = variable.attributes;
        environment[varAttrs.env_variable] = varAttrs.default_value || '';
      });
    }

    const serverData = {
      name: `${invoice.userEmail}'s ${plan.name} Server`,
      user: invoice.userId,
      egg: egg.id,
      docker_image: egg.docker_image,
      startup: egg.startup,
      environment: environment,
      limits: {
        memory: plan.memory,
        swap: 0,
        disk: plan.disk,
        io: 500,
        cpu: plan.cpu
      },
      feature_limits: {
        databases: plan.databases || 0,
        backups: plan.backups || 0
      },
      allocation: {
        default: availableAllocation.attributes.id
      }
    };

    const serverResponse = await pterodactylAPI.post('/servers', serverData);
    const serverId = serverResponse.data.attributes.id;
    const serverName = serverResponse.data.attributes.name;
    
    // Update invoice with server ID and set expiration
    const data = await readInvoicesData();
    const invoiceIndex = data.invoices.findIndex(inv => inv._id === invoice._id);
    
    if (invoiceIndex !== -1) {
      // Calculate expiration date based on trial status
      let expirationDate = new Date();
      if (invoice.is_trial) {
        // Trial servers expire in trial_days (default 7 days)
        expirationDate.setDate(expirationDate.getDate() + (invoice.trial_days || 7));
      } else {
        // Regular servers expire in 30 days
        expirationDate.setDate(expirationDate.getDate() + 30);
      }
      
      data.invoices[invoiceIndex].serverId = serverId;
      data.invoices[invoiceIndex].serverExpiresAt = expirationDate.toISOString();
      data.invoices[invoiceIndex].updatedAt = new Date().toISOString();
      
      await writeInvoicesData(data);
      
      // Create server expiration entry
      const expData = await readServerExpirationsData();
      const newExpiration = {
        _id: generateId(),
        serverId: serverId,
        serverName: serverName,
        userId: invoice.userId,
        userEmail: invoice.userEmail,
        expirationDate: expirationDate.toISOString(),
        notes: invoice.is_trial ? `Trial server - ${invoice.trial_days} days` : `Regular server - 30 days`,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        notificationsSent: [],
        renewalHistory: []
      };
      
      expData.expirations.push(newExpiration);
      await writeServerExpirationsData(expData);
      
      console.log(`Server created: ${serverId}, Expires at: ${expirationDate.toISOString()}, Trial: ${invoice.is_trial ? 'Yes' : 'No'}`);
    }
  } catch (error) {
    console.error('Error creating server:', error);
    throw error;
  }
}

// Check invoice payment status
app.get('/api/invoices/:id/status', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const data = await readInvoicesData();
    const invoice = data.invoices.find(inv => inv._id === req.params.id && inv.userId === decoded.id);
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json({ 
      status: invoice.status,
      paidAt: invoice.paidAt,
      expiresAt: invoice.expiresAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user's invoices
app.get('/api/user/invoices', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const data = await readInvoicesData();
    const userInvoices = data.invoices.filter(inv => inv.userId === decoded.id);
    
    res.json({ data: userInvoices });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get all invoices
app.get('/api/admin/invoices', adminOnly, async (req, res) => {
  try {
    const data = await readInvoicesData();
    res.json({ data: data.invoices });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Update invoice status (accept/reject)
app.patch('/api/admin/invoices/:id', adminOnly, async (req, res) => {
  try {
    const data = await readInvoicesData();
    const index = data.invoices.findIndex(inv => inv._id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = data.invoices[index];
    const newStatus = req.body.status;

    if (newStatus === 'approved') {
      // Admin can approve from ANY status — no payment required
      invoice.status = 'approved';
      invoice.approvedAt = new Date().toISOString();
      invoice.paidAt = invoice.paidAt || new Date().toISOString();
      invoice.updatedAt = new Date().toISOString();

      data.invoices[index] = invoice;
      await writeInvoicesData(data);

      // Trigger server creation in background
      createServerForInvoice(invoice).catch(err =>
        console.error('Server creation error after admin approval:', err.message)
      );

      return res.json({ data: invoice, message: 'Invoice approved — server creation started' });

    } else if (newStatus === 'rejected') {
      invoice.status = 'rejected';
      invoice.rejectedAt = new Date().toISOString();
      invoice.updatedAt = new Date().toISOString();
    } else {
      // Allow setting any other status directly
      invoice.status = newStatus;
      invoice.updatedAt = new Date().toISOString();
    }

    data.invoices[index] = invoice;
    await writeInvoicesData(data);
    res.json({ data: invoice });
  } catch (error) {
    console.error('Error updating invoice:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// Admin: Delete invoice
app.delete('/api/admin/invoices/:id', adminOnly, async (req, res) => {
  try {
    const data = await readInvoicesData();
    data.invoices = data.invoices.filter(inv => inv._id !== req.params.id);
    await writeInvoicesData(data);
    res.json({ message: 'Invoice deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cleanup rejected invoices older than 24 hours
setInterval(async () => {
  try {
    const data = await readInvoicesData();
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    data.invoices = data.invoices.filter(inv => {
      if (inv.status === 'rejected' && inv.rejectedAt) {
        try {
          const rejectedDate = new Date(inv.rejectedAt);
          // Check if date is valid
          if (isNaN(rejectedDate.getTime())) {
            console.warn(`Invalid rejectedAt date for invoice ${inv._id}: ${inv.rejectedAt}`);
            return false; // Remove invoices with invalid dates
          }
          return rejectedDate > oneDayAgo;
        } catch (error) {
          console.warn(`Error parsing rejectedAt date for invoice ${inv._id}: ${error.message}`);
          return false; // Remove invoices with unparseable dates
        }
      }
      return true;
    });
    
    await writeInvoicesData(data);
  } catch (error) {
    console.error('Error cleaning up invoices:', error);
  }
}, 60 * 60 * 1000); // Run every hour

// Message Routes
// Get all messages (admin only)
app.get('/api/admin/messages', adminOnly, async (req, res) => {
  try {
    const messages = await messagesDB.getAllMessages();
    res.json({ 
      success: true, 
      data: messages 
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Get single message (admin only)
app.get('/api/admin/messages/:id', adminOnly, async (req, res) => {
  try {
    const message = await messagesDB.getMessageById(req.params.id);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    res.json({ 
      success: true, 
      data: message 
    });
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});

// Send message (admin only - for replying)
app.post('/api/admin/messages', adminOnly, async (req, res) => {
  try {
    const { toUserId, toEmail, subject, message, replyTo } = req.body;
    
    if (!toEmail || !subject || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const newMessage = await messagesDB.createMessage({
      user_id: toUserId || 0,
      user_email: toEmail,
      subject: subject,
      message: message,
      reply_to: replyTo || null
    });
    
    res.json({ 
      success: true, 
      message: 'Message sent successfully',
      data: newMessage
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Update message status (admin only)
app.patch('/api/admin/messages/:id/status', adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!status || !['unread', 'read', 'replied'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    const updated = await messagesDB.updateMessageStatus(req.params.id, status);
    res.json({ 
      success: true, 
      message: 'Message status updated',
      data: updated
    });
  } catch (error) {
    console.error('Error updating message status:', error);
    res.status(500).json({ error: 'Failed to update message status' });
  }
});

// Delete message (admin only)
app.delete('/api/admin/messages/:id', adminOnly, async (req, res) => {
  try {
    await messagesDB.deleteMessage(req.params.id);
    res.json({ 
      success: true, 
      message: 'Message deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Get user's messages (authenticated users)
app.get('/api/user/messages', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const messages = await messagesDB.getUserMessages(decoded.id);
    
    res.json({ 
      success: true, 
      data: messages 
    });
  } catch (error) {
    console.error('Error fetching user messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Contact form submission
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    
    // Validate required fields
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Try to get user ID from token if available
    let userId = 0; // Default for non-authenticated users
    try {
      const token = req.headers.authorization?.split(' ')[1];
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        userId = decoded.id || 0;
      }
    } catch (tokenError) {
      // Token is invalid or expired, treat as guest
      console.log('Contact form submitted by guest user');
    }
    
    // Save message to database
    const newMessage = await messagesDB.createMessage({
      user_id: userId,
      user_email: email,
      subject: subject,
      message: message,
      reply_to: null
    });
    
    console.log('Contact form submission saved to database:', {
      id: newMessage.id,
      name,
      email,
      subject,
      messageLength: message.length,
      timestamp: new Date().toISOString()
    });
    
    res.json({ 
      success: true, 
      message: 'Thank you for your message! We will get back to you soon.',
      data: {
        id: newMessage.id,
        name,
        email,
        subject,
        messageLength: message.length
      }
    });
    
  } catch (error) {
    console.error('Error processing contact form:', error);
    res.status(500).json({ error: 'Failed to process contact form submission' });
  }
});

// ============================================
// SERVER EXPIRATION MANAGEMENT ROUTES
// ============================================

// Data file for server expirations
const SERVER_EXPIRATIONS_FILE = path.join(__dirname, 'data', 'serverExpirations.json');

const readServerExpirationsData = async () => {
  try {
    const data = await fs.readFile(SERVER_EXPIRATIONS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return { expirations: [] };
  }
};

const writeServerExpirationsData = async (data) => {
  await fs.writeFile(SERVER_EXPIRATIONS_FILE, JSON.stringify(data, null, 2));
};

// Admin: Get all server expirations
app.get('/api/admin/server-expirations', adminOnly, async (req, res) => {
  try {
    const data = await readServerExpirationsData();
    const expirations = data.expirations.map(exp => ({
      ...exp,
      daysUntilExpiration: Math.ceil((new Date(exp.expirationDate) - new Date()) / (1000 * 60 * 60 * 24)),
      isExpired: new Date(exp.expirationDate) < new Date(),
      isExpiringSoon: Math.ceil((new Date(exp.expirationDate) - new Date()) / (1000 * 60 * 60 * 24)) <= 7
    }));
    res.json({ data: expirations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Add server expiration
app.post('/api/admin/server-expirations', adminOnly, async (req, res) => {
  try {
    const { serverId, serverName, userId, userEmail, expirationDate, notes } = req.body;
    
    if (!serverId || !expirationDate) {
      return res.status(400).json({ error: 'serverId and expirationDate are required' });
    }

    const data = await readServerExpirationsData();
    
    // Check if server already has expiration
    const existingIndex = data.expirations.findIndex(e => e.serverId === serverId);
    if (existingIndex !== -1) {
      return res.status(409).json({ error: 'Server already has expiration set' });
    }

    const newExpiration = {
      _id: generateId(),
      serverId,
      serverName: serverName || `Server ${serverId}`,
      userId,
      userEmail,
      expirationDate: new Date(expirationDate).toISOString(),
      notes: notes || '',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      notificationsSent: []
    };

    data.expirations.push(newExpiration);
    await writeServerExpirationsData(data);
    
    res.json({ data: newExpiration });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Update server expiration
app.put('/api/admin/server-expirations/:id', adminOnly, async (req, res) => {
  try {
    const { expirationDate, notes, status } = req.body;
    const data = await readServerExpirationsData();
    
    const index = data.expirations.findIndex(e => e._id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Expiration not found' });
    }

    if (expirationDate) {
      data.expirations[index].expirationDate = new Date(expirationDate).toISOString();
    }
    if (notes !== undefined) {
      data.expirations[index].notes = notes;
    }
    if (status) {
      data.expirations[index].status = status;
    }
    
    data.expirations[index].updatedAt = new Date().toISOString();
    await writeServerExpirationsData(data);
    
    res.json({ data: data.expirations[index] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Delete server expiration
app.delete('/api/admin/server-expirations/:id', adminOnly, async (req, res) => {
  try {
    const data = await readServerExpirationsData();
    data.expirations = data.expirations.filter(e => e._id !== req.params.id);
    await writeServerExpirationsData(data);
    
    res.json({ message: 'Server expiration removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get expiring soon servers (7 days)
app.get('/api/admin/server-expirations/expiring-soon', adminOnly, async (req, res) => {
  try {
    const data = await readServerExpirationsData();
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const expiringSoon = data.expirations.filter(exp => {
      const expDate = new Date(exp.expirationDate);
      return expDate > now && expDate <= sevenDaysFromNow && exp.status === 'active';
    }).map(exp => ({
      ...exp,
      daysUntilExpiration: Math.ceil((new Date(exp.expirationDate) - now) / (1000 * 60 * 60 * 24))
    }));
    
    res.json({ data: expiringSoon });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get expired servers
app.get('/api/admin/server-expirations/expired', adminOnly, async (req, res) => {
  try {
    const data = await readServerExpirationsData();
    const now = new Date();
    
    const expired = data.expirations.filter(exp => {
      const expDate = new Date(exp.expirationDate);
      return expDate < now && exp.status === 'active';
    }).map(exp => ({
      ...exp,
      daysExpired: Math.ceil((now - new Date(exp.expirationDate)) / (1000 * 60 * 60 * 24))
    }));
    
    res.json({ data: expired });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Suspend expired servers
app.post('/api/admin/server-expirations/:id/suspend', adminOnly, async (req, res) => {
  try {
    const data = await readServerExpirationsData();
    const index = data.expirations.findIndex(e => e._id === req.params.id);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Expiration not found' });
    }

    const expiration = data.expirations[index];
    
    // Suspend the server via Pterodactyl
    try {
      await pterodactylAPI.post(`/servers/${expiration.serverId}/suspend`);
    } catch (pterError) {
      console.error('Error suspending server in Pterodactyl:', pterError.message);
    }
    
    expiration.status = 'suspended';
    expiration.suspendedAt = new Date().toISOString();
    expiration.updatedAt = new Date().toISOString();
    
    data.expirations[index] = expiration;
    await writeServerExpirationsData(data);
    
    res.json({ message: 'Server suspended', data: expiration });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Extend server expiration
app.post('/api/admin/server-expirations/:id/extend', adminOnly, async (req, res) => {
  try {
    const { newExpirationDate } = req.body;
    
    if (!newExpirationDate) {
      return res.status(400).json({ error: 'newExpirationDate is required' });
    }

    const data = await readServerExpirationsData();
    const index = data.expirations.findIndex(e => e._id === req.params.id);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Expiration not found' });
    }

    const expiration = data.expirations[index];
    
    // If suspended, unsuspend it
    if (expiration.status === 'suspended') {
      try {
        await pterodactylAPI.post(`/servers/${expiration.serverId}/unsuspend`);
      } catch (pterError) {
        console.error('Error unsuspending server in Pterodactyl:', pterError.message);
      }
    }
    
    expiration.expirationDate = new Date(newExpirationDate).toISOString();
    expiration.status = 'active';
    expiration.extendedAt = new Date().toISOString();
    expiration.updatedAt = new Date().toISOString();
    
    data.expirations[index] = expiration;
    await writeServerExpirationsData(data);
    
    res.json({ message: 'Server expiration extended', data: expiration });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Send expiration reminder notifications
app.post('/api/admin/server-expirations/:id/send-reminder', adminOnly, async (req, res) => {
  try {
    const data = await readServerExpirationsData();
    const index = data.expirations.findIndex(e => e._id === req.params.id);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Expiration not found' });
    }

    const expiration = data.expirations[index];
    const daysLeft = Math.ceil((new Date(expiration.expirationDate) - new Date()) / (1000 * 60 * 60 * 24));
    
    // Create notification message
    const message = `Your server "${expiration.serverName}" will expire in ${daysLeft} days. Please renew your subscription to keep it running.`;
    
    // Send notification via messages system
    await messagesDB.createMessage({
      user_id: expiration.userId || 0,
      user_email: expiration.userEmail,
      subject: `Server Expiration Reminder: ${expiration.serverName}`,
      message: message,
      reply_to: null
    });
    
    // Record notification sent
    expiration.notificationsSent.push({
      sentAt: new Date().toISOString(),
      daysUntilExpiration: daysLeft
    });
    expiration.updatedAt = new Date().toISOString();
    
    data.expirations[index] = expiration;
    await writeServerExpirationsData(data);
    
    res.json({ message: 'Reminder sent to user', data: expiration });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// User: Renew server (add days based on billing period)
app.post('/api/user/servers/:serverId/renew', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const { billingMonths } = req.body; // Number of months to add (1, 3, 6, or 12)
    
    if (!billingMonths || ![1, 3, 6, 12].includes(billingMonths)) {
      return res.status(400).json({ error: 'Invalid billing period. Must be 1, 3, 6, or 12 months' });
    }

    // Find server expiration
    const expData = await readServerExpirationsData();
    const expIndex = expData.expirations.findIndex(e => 
      e.serverId === parseInt(req.params.serverId) && e.userId === decoded.id
    );
    
    if (expIndex === -1) {
      return res.status(404).json({ error: 'Server expiration not found' });
    }

    const expiration = expData.expirations[expIndex];
    
    // Check if server is a trial server
    const invoicesData = await readInvoicesData();
    const serverInvoice = invoicesData.invoices.find(inv => inv.serverId === parseInt(req.params.serverId));
    
    if (serverInvoice && serverInvoice.is_trial) {
      return res.status(400).json({ error: 'Trial servers cannot be renewed. Please purchase a regular plan.' });
    }
    
    // Calculate days to add (30 days per month)
    const daysToAdd = billingMonths * 30;
    
    // Get current expiration date or use now if already expired
    const currentExpDate = new Date(expiration.expirationDate);
    const now = new Date();
    const baseDate = currentExpDate > now ? currentExpDate : now;
    
    // Add days to expiration
    const newExpDate = new Date(baseDate);
    newExpDate.setDate(newExpDate.getDate() + daysToAdd);
    
    // If server was suspended, unsuspend it
    if (expiration.status === 'suspended') {
      try {
        await pterodactylAPI.post(`/servers/${expiration.serverId}/unsuspend`);
      } catch (pterError) {
        console.error('Error unsuspending server:', pterError.message);
      }
    }
    
    // Update expiration
    expiration.expirationDate = newExpDate.toISOString();
    expiration.status = 'active';
    expiration.renewedAt = new Date().toISOString();
    expiration.updatedAt = new Date().toISOString();
    expiration.renewalHistory = expiration.renewalHistory || [];
    expiration.renewalHistory.push({
      renewedAt: new Date().toISOString(),
      daysAdded: daysToAdd,
      billingMonths: billingMonths,
      newExpirationDate: newExpDate.toISOString()
    });
    
    expData.expirations[expIndex] = expiration;
    await writeServerExpirationsData(expData);
    
    // Send confirmation message
    await messagesDB.createMessage({
      user_id: decoded.id,
      user_email: decoded.email,
      subject: `Server Renewed: ${expiration.serverName}`,
      message: `Your server "${expiration.serverName}" has been successfully renewed for ${billingMonths} month(s). New expiration date: ${newExpDate.toLocaleDateString()}`,
      reply_to: null
    });
    
    res.json({ 
      message: 'Server renewed successfully',
      data: {
        serverId: expiration.serverId,
        serverName: expiration.serverName,
        daysAdded: daysToAdd,
        newExpirationDate: newExpDate.toISOString(),
        status: expiration.status
      }
    });
  } catch (error) {
    console.error('Error renewing server:', error);
    res.status(500).json({ error: error.message });
  }
});

// User: Get ALL server expirations for the logged-in user
app.get('/api/user/server-expirations', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const expData = await readServerExpirationsData();
    const now = new Date();

    const userExpirations = expData.expirations
      .filter(e => String(e.userId) === String(decoded.id))
      .map(e => {
        const expDate = new Date(e.expirationDate);
        const daysLeft = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
        return {
          ...e,
          days_left: daysLeft,
          is_expired: expDate < now,
          is_expiring_soon: daysLeft <= 7 && daysLeft > 0
        };
      });

    res.json({ data: userExpirations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// User: Get server expiration info by serverId param
app.get('/api/user/server-expirations/:serverId', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const expData = await readServerExpirationsData();
    const now = new Date();

    const exp = expData.expirations.find(e =>
      String(e.serverId) === String(req.params.serverId) &&
      String(e.userId) === String(decoded.id)
    );

    if (!exp) return res.status(404).json({ error: 'Not found' });

    const expDate = new Date(exp.expirationDate);
    const daysLeft = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));

    res.json({
      data: {
        ...exp,
        days_left: daysLeft,
        is_expired: expDate < now,
        is_expiring_soon: daysLeft <= 7 && daysLeft > 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// User: Get server expiration info (legacy route with serverId in path)
app.get('/api/user/servers/:serverId/expiration', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    const expData = await readServerExpirationsData();
    const expiration = expData.expirations.find(e => 
      e.serverId === parseInt(req.params.serverId) && e.userId === decoded.id
    );
    
    if (!expiration) {
      return res.status(404).json({ error: 'Server expiration not found' });
    }

    const now = new Date();
    const expDate = new Date(expiration.expirationDate);
    const daysUntilExpiration = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
    
    res.json({
      data: {
        ...expiration,
        daysUntilExpiration,
        isExpired: expDate < now,
        isExpiringSoon: daysUntilExpiration <= 7 && daysUntilExpiration > 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Auto-suspend expired servers and delete after grace period (background job)
async function autoManageServerLifecycle() {
  try {
    const data = await readServerExpirationsData();
    const invoicesData = await readInvoicesData();
    const now = new Date();
    let suspended = 0;
    let deleted = 0;

    for (let i = 0; i < data.expirations.length; i++) {
      const expiration = data.expirations[i];
      const expDate = new Date(expiration.expirationDate);
      const daysSinceExpiration = Math.ceil((now - expDate) / (1000 * 60 * 60 * 24));

      // If expired and active, suspend it
      if (expDate < now && expiration.status === 'active') {
        try {
          await pterodactylAPI.post(`/servers/${expiration.serverId}/suspend`);
          expiration.status = 'suspended';
          expiration.suspendedAt = new Date().toISOString();
          suspended++;
          
          // Send suspension notification
          await messagesDB.createMessage({
            user_id: expiration.userId || 0,
            user_email: expiration.userEmail,
            subject: `Server Suspended: ${expiration.serverName}`,
            message: `Your server "${expiration.serverName}" has been suspended due to expiration. You have 3 days to renew before it will be permanently deleted.`,
            reply_to: null
          });
        } catch (error) {
          console.error(`Error suspending server ${expiration.serverId}:`, error.message);
        }
      }
      
      // If suspended for more than 3 days, delete it
      if (expiration.status === 'suspended' && daysSinceExpiration >= 3) {
        try {
          await pterodactylAPI.delete(`/servers/${expiration.serverId}`);
          expiration.status = 'deleted';
          expiration.deletedAt = new Date().toISOString();
          deleted++;
          
          // Send deletion notification
          await messagesDB.createMessage({
            user_id: expiration.userId || 0,
            user_email: expiration.userEmail,
            subject: `Server Deleted: ${expiration.serverName}`,
            message: `Your server "${expiration.serverName}" has been permanently deleted after 3 days of suspension. Please purchase a new plan if you wish to continue using our services.`,
            reply_to: null
          });
        } catch (error) {
          console.error(`Error deleting server ${expiration.serverId}:`, error.message);
        }
      }
    }

    if (suspended > 0 || deleted > 0) {
      await writeServerExpirationsData(data);
      console.log(`Server lifecycle management: Suspended ${suspended}, Deleted ${deleted}`);
    }
  } catch (error) {
    console.error('Error in server lifecycle management:', error);
  }
}

// Run lifecycle management check every hour
setInterval(autoManageServerLifecycle, 60 * 60 * 1000);

// Run once on startup
autoManageServerLifecycle();

// ── Self-ping to keep Render free tier alive ──
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(async () => {
  try {
    await axios.get(SELF_URL);
    console.log(`[ping] ${new Date().toISOString()} — kept alive`);
  } catch (e) {
    console.warn(`[ping] failed: ${e.message}`);
  }
}, 5 * 60 * 1000); // every 5 minutes

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

