const { Types } = require("mongoose");
const WhatsAppAutomation = require("../models/WhatsAppAutomation");
const WhatsAppAutomationJob = require("../models/WhatsAppAutomationJob");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const WhatsAppContact = require("../models/WhatsAppContact");
const WhatsAppMessage = require("../models/WhatsAppMessage");
const AdminUser = require("../models/AdminUser");
const { sendMessage } = require("./whatsappService");

const AUTOMATION_TRIGGER_TYPES = ["new_conversation", "any_inbound_message", "keyword_match"];
const AUTOMATION_ACTION_TYPES = ["send_text", "send_template", "send_buttons", "send_list", "add_tag", "add_note", "set_status", "assign_agent"];

let workerInterval = null;
let workerInFlight = false;

const toIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const normalizeStringArray = (value) => {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return Array.from(
    new Set(
      source
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );
};

const sanitizeWorkflowNode = (node = {}) => {
  const nodeId = String(node?.nodeId || "").trim();
  const kind = String(node?.kind || "").trim().toLowerCase();

  if (!nodeId) {
    throw new Error("Workflow node id is required");
  }

  if (!["trigger", "condition", "delay", "send_text", "send_template", "send_buttons", "send_list", "add_tag", "add_note", "set_status", "assign_agent"].includes(kind)) {
    throw new Error(`Unsupported workflow node type: ${kind || "unknown"}`);
  }

  return {
    nodeId,
    kind,
    label: String(node?.label || "").trim(),
    position: {
      x: Number(node?.position?.x || 0),
      y: Number(node?.position?.y || 0),
    },
    config: node?.config && typeof node.config === "object" ? node.config : {},
  };
};

const sanitizeWorkflowEdge = (edge = {}) => {
  const edgeId = String(edge?.edgeId || "").trim();
  const source = String(edge?.source || "").trim();
  const target = String(edge?.target || "").trim();

  if (!edgeId || !source || !target) {
    throw new Error("Workflow edge requires id, source, and target");
  }

  return {
    edgeId,
    source,
    target,
    label: String(edge?.label || "").trim(),
  };
};

const buildActionFromWorkflowNode = (node) => {
  const config = node?.config && typeof node.config === "object" ? node.config : {};

  if (node.kind === "delay") {
    return {
      type: "send_text",
      label: node.label || "Delay",
      delayMinutes: Number(config.delayMinutes || 0),
      config: {
        text: String(config.previewText || "Automated delay placeholder").trim(),
      },
    };
  }

  return {
    type: node.kind,
    label: node.label || "",
    delayMinutes: 0,
    config,
  };
};

const deriveActionsFromWorkflowGraph = (workflowGraph = {}) => {
  const nodes = Array.isArray(workflowGraph?.nodes) ? workflowGraph.nodes : [];

  if (!nodes.length) {
    throw new Error("Visual workflow requires at least one node");
  }

  if (!nodes.some((node) => node.kind === "trigger")) {
    throw new Error("Visual workflow requires a trigger node");
  }

  const sortedNodes = [...nodes].sort((a, b) => {
    const leftX = Number(a?.position?.x || 0);
    const rightX = Number(b?.position?.x || 0);
    if (leftX !== rightX) return leftX - rightX;
    return Number(a?.position?.y || 0) - Number(b?.position?.y || 0);
  });

  const actions = [];
  let pendingDelay = 0;
  for (const node of sortedNodes) {
    if (node.kind === "trigger" || node.kind === "condition") continue;
    if (node.kind === "delay") {
      pendingDelay = Number(node?.config?.delayMinutes || 0);
      continue;
    }

    const nextAction = sanitizeAutomationAction(buildActionFromWorkflowNode(node));
    if (pendingDelay > 0) {
      nextAction.delayMinutes = pendingDelay;
      pendingDelay = 0;
    }
    actions.push(nextAction);
  }

  if (!actions.length) {
    throw new Error("Visual workflow needs at least one executable step");
  }

  return actions;
};

const sanitizeAutomationAction = (action = {}) => {
  const type = String(action?.type || "").trim().toLowerCase();
  if (!AUTOMATION_ACTION_TYPES.includes(type)) {
    throw new Error(`Unsupported automation action type: ${type || "unknown"}`);
  }

  const delayMinutes = Number(action?.delayMinutes || 0);
  const config = action?.config && typeof action.config === "object" ? action.config : {};

  return {
    type,
    label: String(action?.label || "").trim(),
    delayMinutes: Number.isFinite(delayMinutes) && delayMinutes > 0 ? delayMinutes : 0,
    config,
  };
};

const sanitizeAutomationPayload = (payload = {}, adminId = null) => {
  const name = String(payload?.name || "").trim();
  if (!name) {
    throw new Error("Automation name is required");
  }

  const triggerType = String(payload?.triggerType || "").trim().toLowerCase();
  if (!AUTOMATION_TRIGGER_TYPES.includes(triggerType)) {
    throw new Error("Unsupported automation trigger");
  }

  const builderMode = String(payload?.builderMode || "linear").trim().toLowerCase() === "visual" ? "visual" : "linear";
  const workflowGraph = {
    nodes: Array.isArray(payload?.workflowGraph?.nodes) ? payload.workflowGraph.nodes.map(sanitizeWorkflowNode) : [],
    edges: Array.isArray(payload?.workflowGraph?.edges) ? payload.workflowGraph.edges.map(sanitizeWorkflowEdge) : [],
  };

  const actions = builderMode === "visual"
    ? deriveActionsFromWorkflowGraph(workflowGraph)
    : Array.isArray(payload?.actions)
      ? payload.actions.map(sanitizeAutomationAction)
      : [];
  if (!actions.length) {
    throw new Error("Add at least one automation action");
  }

  const assignedAgentIds = Array.isArray(payload?.assignedAgentIds)
    ? payload.assignedAgentIds.filter((value) => Types.ObjectId.isValid(String(value || ""))).map((value) => new Types.ObjectId(String(value)))
    : [];

  return {
    name,
    description: String(payload?.description || "").trim(),
    enabled: payload?.enabled !== false,
    triggerType,
    triggerConfig: {
      keywords: normalizeStringArray(payload?.triggerConfig?.keywords),
      businessHoursOnly: Boolean(payload?.triggerConfig?.businessHoursOnly),
      startHour: Number(payload?.triggerConfig?.startHour ?? 9),
      endHour: Number(payload?.triggerConfig?.endHour ?? 18),
      timezone: String(payload?.triggerConfig?.timezone || "Asia/Colombo").trim(),
    },
    actions,
    builderMode,
    workflowGraph,
    allowedRoles: normalizeStringArray(payload?.allowedRoles).length
      ? normalizeStringArray(payload.allowedRoles)
      : ["MainAdmin", "SalesAdmin"],
    assignedAgentIds,
    updatedBy: adminId || null,
  };
};

const resolveBusinessHoursMatch = (triggerConfig = {}) => {
  if (!triggerConfig.businessHoursOnly) return true;

  const timezone = String(triggerConfig.timezone || "Asia/Colombo");
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: timezone,
  });

  const currentHour = Number(formatter.format(new Date()));
  const startHour = Number(triggerConfig.startHour ?? 9);
  const endHour = Number(triggerConfig.endHour ?? 18);

  return currentHour >= startHour && currentHour < endHour;
};

const resolveKeywordMatch = (messageText = "", triggerConfig = {}) => {
  const keywords = normalizeStringArray(triggerConfig.keywords).map((item) => item.toLowerCase());
  if (!keywords.length) return false;

  const normalizedMessage = String(messageText || "").trim().toLowerCase();
  if (!normalizedMessage) return false;

  return keywords.some((keyword) => normalizedMessage.includes(keyword));
};

const applyTemplateVariables = (template, context) => {
  const components = Array.isArray(template?.components) ? template.components : [];

  return {
    name: String(template?.name || "").trim(),
    languageCode: String(template?.languageCode || template?.language || "en_US"),
    headerFormat: String(template?.headerFormat || "").trim().toUpperCase(),
    defaultHeaderMedia: template?.defaultHeaderMedia?.url ? template.defaultHeaderMedia : null,
    components: components.map((component) => {
      if (String(component?.type || "").toLowerCase() !== "body") return component;

      const parameters = Array.isArray(component?.parameters) ? component.parameters : [];
      return {
        ...component,
        parameters: parameters.map((parameter) => ({
          ...parameter,
          text: interpolateTemplateText(parameter?.text, context),
        })),
      };
    }),
  };
};

const interpolateTemplateText = (text = "", context = {}) =>
  String(text || "").replace(/{{\s*([^}]+)\s*}}/g, (_match, key) => {
    const normalizedKey = String(key || "").trim().toLowerCase();
    const tokens = normalizedKey.split(".");
    let current = context;
    for (const token of tokens) {
      current = current?.[token];
      if (current === undefined || current === null) break;
    }
    return current === undefined || current === null ? "" : String(current);
  });

const buildExecutionContext = async ({ conversation, contact, inboundMessage }) => {
  const agent = conversation?.agentId
    ? await AdminUser.findById(conversation.agentId).select("_id name email role").lean()
    : null;

  return {
    conversation: {
      id: toIdString(conversation?._id),
      status: String(conversation?.status || ""),
      workflowStatus: String(conversation?.workflowStatus || ""),
      unreadCount: Number(conversation?.unreadCount || 0),
    },
    contact: {
      id: toIdString(contact?._id),
      name: String(contact?.name || contact?.profile?.name || ""),
      phone: String(contact?.phone || ""),
      email: String(contact?.email || contact?.profile?.email || ""),
    },
    message: {
      id: toIdString(inboundMessage?._id),
      text: String(inboundMessage?.content || ""),
      type: String(inboundMessage?.type || "text"),
      interactiveReplyId: String(inboundMessage?.metadata?.interactiveReply?.id || ""),
      interactiveReplyTitle: String(inboundMessage?.metadata?.interactiveReply?.title || ""),
    },
    agent: {
      id: toIdString(agent?._id),
      name: String(agent?.name || ""),
      email: String(agent?.email || ""),
      role: String(agent?.role || ""),
    },
  };
};

const getWorkflowNodeMap = (automation = {}) => {
  const nodes = Array.isArray(automation?.workflowGraph?.nodes) ? automation.workflowGraph.nodes : [];
  return new Map(nodes.map((node) => [String(node.nodeId), node]));
};

const getWorkflowOutgoingEdges = (automation = {}, sourceNodeId = "") =>
  (Array.isArray(automation?.workflowGraph?.edges) ? automation.workflowGraph.edges : []).filter(
    (edge) => String(edge?.source || "") === String(sourceNodeId || "")
  );

const buildInteractiveReplyMap = ({ node, outgoingEdges = [] }) => {
  const options = node.kind === "send_buttons"
    ? Array.isArray(node?.config?.buttons) ? node.config.buttons : []
    : node.kind === "send_list"
      ? Array.isArray(node?.config?.rows) ? node.config.rows : []
      : [];

  return options.map((option, index) => {
    const optionId = String(option?.id || option?.title || `option_${index + 1}`).trim();
    const optionTitle = String(option?.title || "").trim();
    const matchedEdge = outgoingEdges.find((edge) => String(edge?.label || "").trim() === optionId || String(edge?.label || "").trim() === optionTitle);
    return {
      id: optionId,
      title: optionTitle,
      targetNodeId: matchedEdge?.target || "",
    };
  });
};

const evaluateConditionNode = ({ node, context }) => {
  const config = node?.config && typeof node.config === "object" ? node.config : {};
  const field = String(config.field || "message.text").trim().toLowerCase();
  const operator = String(config.operator || "contains").trim().toLowerCase();
  const value = String(config.value || "").trim().toLowerCase();
  const sourceValue = interpolateTemplateText(`{{${field}}}`, context).trim().toLowerCase();

  if (operator === "equals") return sourceValue === value;
  if (operator === "starts_with") return sourceValue.startsWith(value);
  if (operator === "contains_any") {
    const options = normalizeStringArray(config.values || config.value);
    return options.some((option) => sourceValue.includes(String(option).toLowerCase()));
  }
  return sourceValue.includes(value);
};

const executeAutomationAction = async ({ app, automation, action, conversation, contact, inboundMessage, context }) => {
  if (!action?.type) return "Skipped";

  if (action.type === "send_text") {
    const resolvedText = interpolateTemplateText(action?.config?.text || "", context).trim();
    if (!resolvedText) {
      throw new Error("Automation text action requires message text");
    }

    const { payload, response } = await sendMessage({
      to: contact.phone,
      type: "text",
      text: resolvedText,
      context: {
        conversationId: conversation._id,
        contactId: contact._id,
        automationId: automation._id,
      },
    });

    const { saveOutgoingMessage } = require("./whatsappCRMService");
    await saveOutgoingMessage({
      app,
      conversation,
      contact,
      agentId: conversation.agentId || null,
      messageType: "text",
      content: resolvedText,
      response,
      requestPayload: payload,
      media: null,
    });

    return "Sent automated text";
  }

  if (action.type === "send_template") {
    const template = applyTemplateVariables(action?.config?.template || {}, context);
    if (!template.name) {
      throw new Error("Automation template action requires a template");
    }

    const resolvedTemplate = { ...template };
    const headerFormat = String(resolvedTemplate.headerFormat || "").toUpperCase();
    if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat)) {
      const defaultHeaderMedia = resolvedTemplate.defaultHeaderMedia;
      if (!defaultHeaderMedia?.url) {
        throw new Error(`Automation template ${template.name} requires saved default media`);
      }

      const mediaKey = headerFormat.toLowerCase();
      const nonHeaderComponents = (resolvedTemplate.components || []).filter(
        (component) => String(component?.type || "").toLowerCase() !== "header"
      );
      resolvedTemplate.components = [
        {
          type: "header",
          parameters: [
            {
              type: mediaKey,
              [mediaKey]: {
                link: defaultHeaderMedia.url,
                ...(mediaKey === "document" && defaultHeaderMedia.fileName ? { filename: defaultHeaderMedia.fileName } : {}),
              },
            },
          ],
        },
        ...nonHeaderComponents,
      ];
    }

    const { payload, response } = await sendMessage({
      to: contact.phone,
      type: "template",
      template: resolvedTemplate,
      context: {
        conversationId: conversation._id,
        contactId: contact._id,
        automationId: automation._id,
      },
    });

    const { saveOutgoingMessage } = require("./whatsappCRMService");
    await saveOutgoingMessage({
      app,
      conversation,
      contact,
      agentId: conversation.agentId || null,
      messageType: "template",
      content: `Template: ${resolvedTemplate.name}`,
      response,
      requestPayload: payload,
      media: resolvedTemplate.defaultHeaderMedia || null,
    });

    return `Sent template ${resolvedTemplate.name}`;
  }

  if (action.type === "send_buttons") {
    const bodyText = interpolateTemplateText(action?.config?.bodyText || "", context).trim();
    const buttons = Array.isArray(action?.config?.buttons)
      ? action.config.buttons
          .map((button, index) => ({
            type: "reply",
            reply: {
              id: String(button?.id || `btn_${index + 1}`).trim(),
              title: String(button?.title || "").trim().slice(0, 20),
            },
          }))
          .filter((button) => button.reply.title)
          .slice(0, 3)
      : [];

    if (!bodyText || !buttons.length) {
      throw new Error("Interactive buttons action requires body text and at least one button");
    }

    const interactive = {
      type: "button",
      body: { text: bodyText },
      action: { buttons },
    };

    if (String(action?.config?.headerText || "").trim()) {
      interactive.header = { type: "text", text: String(action.config.headerText).trim() };
    }
    if (String(action?.config?.footerText || "").trim()) {
      interactive.footer = { text: String(action.config.footerText).trim() };
    }

    const { payload, response } = await sendMessage({
      to: contact.phone,
      type: "interactive",
      interactive,
      context: {
        conversationId: conversation._id,
        contactId: contact._id,
        automationId: automation._id,
      },
    });

    const { saveOutgoingMessage } = require("./whatsappCRMService");
    await saveOutgoingMessage({
      app,
      conversation,
      contact,
      agentId: conversation.agentId || null,
      messageType: "interactive",
      content: bodyText,
      response,
      requestPayload: payload,
      media: null,
    });

    return `Sent interactive buttons`;
  }

  if (action.type === "send_list") {
    const bodyText = interpolateTemplateText(action?.config?.bodyText || "", context).trim();
    const buttonText = String(action?.config?.buttonText || "View options").trim();
    const rows = Array.isArray(action?.config?.rows)
      ? action.config.rows
          .map((row, index) => ({
            id: String(row?.id || `row_${index + 1}`).trim(),
            title: String(row?.title || "").trim().slice(0, 24),
            ...(String(row?.description || "").trim() ? { description: String(row.description).trim().slice(0, 72) } : {}),
          }))
          .filter((row) => row.title)
          .slice(0, 10)
      : [];

    if (!bodyText || !rows.length) {
      throw new Error("Interactive list action requires body text and at least one row");
    }

    const interactive = {
      type: "list",
      body: { text: bodyText },
      action: {
        button: buttonText,
        sections: [
          {
            title: String(action?.config?.sectionTitle || "Options").trim(),
            rows,
          },
        ],
      },
    };

    if (String(action?.config?.headerText || "").trim()) {
      interactive.header = { type: "text", text: String(action.config.headerText).trim() };
    }
    if (String(action?.config?.footerText || "").trim()) {
      interactive.footer = { text: String(action.config.footerText).trim() };
    }

    const { payload, response } = await sendMessage({
      to: contact.phone,
      type: "interactive",
      interactive,
      context: {
        conversationId: conversation._id,
        contactId: contact._id,
        automationId: automation._id,
      },
    });

    const { saveOutgoingMessage } = require("./whatsappCRMService");
    await saveOutgoingMessage({
      app,
      conversation,
      contact,
      agentId: conversation.agentId || null,
      messageType: "interactive",
      content: bodyText,
      response,
      requestPayload: payload,
      media: null,
    });

    return `Sent interactive list`;
  }

  if (action.type === "add_tag") {
    const tagsToAdd = normalizeStringArray(action?.config?.tags);
    if (!tagsToAdd.length) throw new Error("Automation tag action requires at least one tag");
    const nextTags = Array.from(new Set([...(conversation.tags || []), ...tagsToAdd]));
    conversation.tags = nextTags;
    await conversation.save();
    const { emitConversationEvents } = require("./whatsappCRMService");
    await emitConversationEvents(app, conversation._id);
    return `Added ${tagsToAdd.length} tag(s)`;
  }

  if (action.type === "add_note") {
    const text = interpolateTemplateText(action?.config?.text || "", context).trim();
    if (!text) throw new Error("Automation note action requires note text");
    const { addConversationNote, emitConversationEvents } = require("./whatsappCRMService");
    await addConversationNote({
      conversationId: conversation._id,
      text,
      authorId: null,
      authorName: `Automation: ${automation.name}`,
    });
    await emitConversationEvents(app, conversation._id);
    return "Added conversation note";
  }

  if (action.type === "set_status") {
    const status = String(action?.config?.status || "").trim();
    if (!["open", "assigned", "closed"].includes(status)) {
      throw new Error("Automation status action requires open, assigned, or closed");
    }
    const { updateConversationStatus, emitConversationEvents } = require("./whatsappCRMService");
    await updateConversationStatus({ conversationId: conversation._id, status });
    await emitConversationEvents(app, conversation._id);
    return `Updated status to ${status}`;
  }

  if (action.type === "assign_agent") {
    const agentId = String(action?.config?.agentId || "").trim();
    if (!Types.ObjectId.isValid(agentId)) {
      throw new Error("Automation assign action requires a valid agent");
    }
    const { assignConversation, emitConversationEvents } = require("./whatsappCRMService");
    await assignConversation({
      conversationId: conversation._id,
      agentId,
      assignedBy: null,
      method: "manual",
    });
    await emitConversationEvents(app, conversation._id);
    return "Assigned conversation";
  }

  throw new Error(`Unsupported automation action: ${action.type}`);
};

const queueDelayedAction = async ({ automation, action, actionIndex, conversation, contact, inboundMessage, contextSnapshot }) => {
  const runAt = new Date(Date.now() + Number(action.delayMinutes || 0) * 60 * 1000);

  await WhatsAppAutomationJob.create({
    automationId: automation._id,
    conversationId: conversation._id,
    contactId: contact._id,
    inboundMessageId: inboundMessage?._id || null,
    triggerType: automation.triggerType,
    actionIndex,
    action,
    contextSnapshot,
    runAt,
    status: "pending",
  });

  return `Queued for ${runAt.toLocaleString()}`;
};

const queueWorkflowResume = async ({ automation, resumeNodeId, conversation, contact, inboundMessage, contextSnapshot, delayMinutes = 0 }) => {
  const runAt = new Date(Date.now() + Number(delayMinutes || 0) * 60 * 1000);

  await WhatsAppAutomationJob.create({
    automationId: automation._id,
    conversationId: conversation._id,
    contactId: contact._id,
    inboundMessageId: inboundMessage?._id || null,
    triggerType: automation.triggerType,
    action: { type: "workflow_resume" },
    resumeNodeId: String(resumeNodeId || ""),
    contextSnapshot,
    runAt,
    status: "pending",
  });

  return `Queued workflow step for ${runAt.toLocaleString()}`;
};

const executeVisualWorkflow = async ({ app, automation, conversation, contact, inboundMessage, context, startNodeId = "trigger-node" }) => {
  const nodeMap = getWorkflowNodeMap(automation);
  const results = [];
  let currentNodeId = startNodeId;
  let safetyCounter = 0;

  while (currentNodeId && safetyCounter < 50) {
    safetyCounter += 1;
    const node = nodeMap.get(String(currentNodeId || ""));
    if (!node) break;

    if (node.kind === "trigger") {
      const nextEdge = getWorkflowOutgoingEdges(automation, node.nodeId)[0];
      currentNodeId = nextEdge?.target || "";
      continue;
    }

    if (node.kind === "condition") {
      const matches = evaluateConditionNode({ node, context });
      const outgoingEdges = getWorkflowOutgoingEdges(automation, node.nodeId);
      const labeledMatch =
        outgoingEdges.find((edge) => String(edge?.label || "").trim().toLowerCase() === (matches ? "true" : "false")) ||
        outgoingEdges[matches ? 0 : 1] ||
        outgoingEdges[0];
      currentNodeId = labeledMatch?.target || "";
      continue;
    }

    if (node.kind === "delay") {
      const nextEdge = getWorkflowOutgoingEdges(automation, node.nodeId)[0];
      if (!nextEdge?.target) break;
      const summary = await queueWorkflowResume({
        automation,
        resumeNodeId: nextEdge.target,
        conversation,
        contact,
        inboundMessage,
        contextSnapshot: context,
        delayMinutes: Number(node?.config?.delayMinutes || 0),
      });
      results.push({
        automationId: toIdString(automation._id),
        automationName: automation.name,
        actionType: "delay",
        summary,
      });
      break;
    }

    const summary = await executeAutomationAction({
      app,
      automation,
      action: sanitizeAutomationAction(buildActionFromWorkflowNode(node)),
      conversation,
      contact,
      inboundMessage,
      context,
    });

    results.push({
      automationId: toIdString(automation._id),
      automationName: automation.name,
      actionType: node.kind,
      summary,
    });

    const outgoingEdges = getWorkflowOutgoingEdges(automation, node.nodeId);
    if (["send_buttons", "send_list"].includes(node.kind)) {
      const replyMap = buildInteractiveReplyMap({ node, outgoingEdges }).filter((item) => item.targetNodeId);
      conversation.workflowContext = {
        status: "awaiting_interactive",
        automationId: toIdString(automation._id),
        nodeId: String(node.nodeId || ""),
        replyMap,
        updatedAt: new Date(),
      };
      await conversation.save();
      const { emitConversationEvents } = require("./whatsappCRMService");
      await emitConversationEvents(app, conversation._id);
      break;
    }

    const nextEdge = outgoingEdges[0];
    currentNodeId = nextEdge?.target || "";
  }

  return results;
};

const processInboundAutomationEvent = async ({ app, conversation, contact, inboundMessage, isNewConversation = false }) => {
  const workflowContext = conversation?.workflowContext && typeof conversation.workflowContext === "object"
    ? conversation.workflowContext
    : null;

  if (workflowContext?.status === "awaiting_interactive" && Types.ObjectId.isValid(String(workflowContext.automationId || ""))) {
    const pendingAutomation = await WhatsAppAutomation.findById(workflowContext.automationId).lean();
    if (pendingAutomation?.enabled) {
      const replyId = String(inboundMessage?.metadata?.interactiveReply?.id || "").trim();
      const replyTitle = String(inboundMessage?.metadata?.interactiveReply?.title || inboundMessage?.content || "").trim();
      const matchedReply = Array.isArray(workflowContext.replyMap)
        ? workflowContext.replyMap.find((item) => String(item?.id || "") === replyId || String(item?.title || "") === replyTitle)
        : null;

      if (matchedReply?.targetNodeId) {
        conversation.workflowContext = null;
        await conversation.save();

        const context = await buildExecutionContext({ conversation, contact, inboundMessage });
        const resumedResults = await executeVisualWorkflow({
          app,
          automation: pendingAutomation,
          conversation,
          contact,
          inboundMessage,
          context,
          startNodeId: matchedReply.targetNodeId,
        });

        await WhatsAppAutomation.updateOne(
          { _id: pendingAutomation._id },
          {
            $inc: { runCount: 1 },
            $set: { lastTriggeredAt: new Date() },
          }
        );

        return resumedResults;
      }
    }
  }

  const automations = await WhatsAppAutomation.find({ enabled: true }).sort({ createdAt: 1 }).lean();
  if (!automations.length) return [];

  const context = await buildExecutionContext({ conversation, contact, inboundMessage });
  const results = [];

  for (const automation of automations) {
    if (Array.isArray(automation.assignedAgentIds) && automation.assignedAgentIds.length) {
      const currentAgentId = toIdString(conversation?.agentId);
      const allowedAgentIds = automation.assignedAgentIds.map((value) => toIdString(value));
      if (!currentAgentId || !allowedAgentIds.includes(currentAgentId)) {
        continue;
      }
    }

    if (!resolveBusinessHoursMatch(automation.triggerConfig)) {
      continue;
    }

    const triggerType = String(automation.triggerType || "").toLowerCase();
    const inboundText = String(inboundMessage?.content || "");
    const triggerMatches =
      (triggerType === "new_conversation" && isNewConversation) ||
      triggerType === "any_inbound_message" ||
      (triggerType === "keyword_match" && resolveKeywordMatch(inboundText, automation.triggerConfig));

    if (!triggerMatches) {
      continue;
    }

    try {
      if (String(automation.builderMode || "linear") === "visual") {
        const workflowResults = await executeVisualWorkflow({
          app,
          automation,
          conversation,
          contact,
          inboundMessage,
          context,
        });
        results.push(...workflowResults);
      } else {
        for (const [actionIndex, action] of (automation.actions || []).entries()) {
          const summary = Number(action.delayMinutes || 0) > 0
            ? await queueDelayedAction({
                automation,
                action,
                actionIndex,
                conversation,
                contact,
                inboundMessage,
                contextSnapshot: context,
              })
            : await executeAutomationAction({
                app,
                automation,
                action,
                conversation,
                contact,
                inboundMessage,
                context,
              });

          results.push({
            automationId: toIdString(automation._id),
            automationName: automation.name,
            actionType: action.type,
            summary,
          });
        }
      }
    } catch (error) {
      results.push({
        automationId: toIdString(automation._id),
        automationName: automation.name,
        actionType: "workflow",
        error: error.message,
      });

      await WhatsAppAutomation.updateOne(
        { _id: automation._id },
        {
          $inc: { errorCount: 1 },
          $set: { lastTriggeredAt: new Date() },
        }
      );
    }

    await WhatsAppAutomation.updateOne(
      { _id: automation._id },
      {
        $inc: { runCount: 1 },
        $set: { lastTriggeredAt: new Date() },
      }
    );
  }

  return results;
};

const processPendingAutomationJobs = async (app) => {
  if (workerInFlight) return;
  workerInFlight = true;

  try {
    const jobs = await WhatsAppAutomationJob.find({
      status: "pending",
      runAt: { $lte: new Date() },
    })
      .sort({ runAt: 1 })
      .limit(20);

    for (const job of jobs) {
      job.status = "processing";
      await job.save();

      try {
        const [automation, conversation, contact, inboundMessage] = await Promise.all([
          WhatsAppAutomation.findById(job.automationId).lean(),
          WhatsAppConversation.findById(job.conversationId),
          WhatsAppContact.findById(job.contactId),
          job.inboundMessageId ? WhatsAppMessage.findById(job.inboundMessageId) : null,
        ]);

        if (!automation?.enabled || !conversation || !contact) {
          job.status = "cancelled";
          job.resultSummary = "Automation, conversation, or contact no longer available";
          job.processedAt = new Date();
          await job.save();
          continue;
        }

        const context = job.contextSnapshot && typeof job.contextSnapshot === "object"
          ? job.contextSnapshot
          : await buildExecutionContext({ conversation, contact, inboundMessage });

        const resultSummary = job.resumeNodeId
          ? (
              await executeVisualWorkflow({
                app,
                automation,
                conversation,
                contact,
                inboundMessage,
                context,
                startNodeId: job.resumeNodeId,
              })
            )
              .map((item) => item.summary)
              .filter(Boolean)
              .join(" | ") || "Workflow resumed"
          : await executeAutomationAction({
              app,
              automation,
              action: job.action,
              conversation,
              contact,
              inboundMessage,
              context,
            });

        job.status = "completed";
        job.resultSummary = resultSummary;
        job.processedAt = new Date();
        await job.save();

        await WhatsAppAutomation.updateOne(
          { _id: automation._id },
          {
            $inc: { runCount: 1 },
            $set: { lastTriggeredAt: new Date() },
          }
        );
      } catch (error) {
        job.status = "failed";
        job.errorMessage = error.message;
        job.processedAt = new Date();
        await job.save();

        await WhatsAppAutomation.updateOne(
          { _id: job.automationId },
          {
            $inc: { errorCount: 1 },
            $set: { lastTriggeredAt: new Date() },
          }
        );
      }
    }
  } finally {
    workerInFlight = false;
  }
};

const startWhatsAppAutomationWorker = (app) => {
  if (workerInterval) return workerInterval;
  workerInterval = setInterval(() => {
    processPendingAutomationJobs(app).catch((error) => {
      console.error("WhatsApp automation worker failed:", error);
    });
  }, 15000);
  return workerInterval;
};

const stopWhatsAppAutomationWorker = () => {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
};

const listAutomations = async () =>
  WhatsAppAutomation.find()
    .populate("assignedAgentIds", "_id name email role")
    .populate("createdBy updatedBy", "_id name email role")
    .sort({ createdAt: -1 })
    .lean();

const listAutomationJobs = async ({ automationId = "" } = {}) => {
  const query = automationId && Types.ObjectId.isValid(automationId) ? { automationId } : {};
  return WhatsAppAutomationJob.find(query)
    .populate("automationId", "_id name")
    .populate("conversationId", "_id")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
};

const createAutomation = async ({ payload, adminId }) => {
  const sanitized = sanitizeAutomationPayload(payload, adminId);
  const automation = await WhatsAppAutomation.create({
    ...sanitized,
    createdBy: adminId || null,
  });
  return WhatsAppAutomation.findById(automation._id)
    .populate("assignedAgentIds", "_id name email role")
    .populate("createdBy updatedBy", "_id name email role")
    .lean();
};

const updateAutomation = async ({ automationId, payload, adminId }) => {
  if (!Types.ObjectId.isValid(String(automationId || ""))) {
    throw new Error("Invalid automation id");
  }

  const sanitized = sanitizeAutomationPayload(payload, adminId);
  const automation = await WhatsAppAutomation.findByIdAndUpdate(
    automationId,
    { $set: sanitized },
    { new: true, runValidators: true }
  )
    .populate("assignedAgentIds", "_id name email role")
    .populate("createdBy updatedBy", "_id name email role")
    .lean();

  if (!automation) throw new Error("Automation not found");
  return automation;
};

const toggleAutomation = async ({ automationId, enabled, adminId }) => {
  if (!Types.ObjectId.isValid(String(automationId || ""))) {
    throw new Error("Invalid automation id");
  }

  const automation = await WhatsAppAutomation.findByIdAndUpdate(
    automationId,
    { $set: { enabled: Boolean(enabled), updatedBy: adminId || null } },
    { new: true }
  )
    .populate("assignedAgentIds", "_id name email role")
    .populate("createdBy updatedBy", "_id name email role")
    .lean();

  if (!automation) throw new Error("Automation not found");
  return automation;
};

const deleteAutomation = async ({ automationId }) => {
  if (!Types.ObjectId.isValid(String(automationId || ""))) {
    throw new Error("Invalid automation id");
  }

  await WhatsAppAutomationJob.deleteMany({ automationId });
  const deleted = await WhatsAppAutomation.findByIdAndDelete(automationId).lean();
  return Boolean(deleted);
};

module.exports = {
  AUTOMATION_TRIGGER_TYPES,
  AUTOMATION_ACTION_TYPES,
  listAutomations,
  listAutomationJobs,
  createAutomation,
  updateAutomation,
  toggleAutomation,
  deleteAutomation,
  processInboundAutomationEvent,
  startWhatsAppAutomationWorker,
  stopWhatsAppAutomationWorker,
};
