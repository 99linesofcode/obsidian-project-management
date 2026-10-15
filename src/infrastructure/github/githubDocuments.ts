export const REPO_QUERY = `
  query RepoNodeId($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) { id }
  }
`;

export const PROJECT_CONTENT_QUERY = `
  query ProjectContent($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        id
        title
        closed
        closedAt
      }
    }
  }
`;

export const REPO_BOARDS_QUERY = `
  query RepoBoards($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      id
      projectsV2(first: 100) {
        nodes {
          id
          title
          url
        }
      }
    }
  }
`;

export const PROJECT_FIELDS_QUERY = `
  query ProjectFields($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        id
        fields(first: 20) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
      }
    }
  }
`;

export const PROJECT_DETAIL_QUERY = `
  query ProjectDetail($owner: String!, $name: String!, $projectId: ID!) {
    repository(owner: $owner, name: $name) {
      issues(first: 100, states: [OPEN, CLOSED]) {
        nodes {
          url
          number
          id
          title
          body
          state
          createdAt
          lastEditedAt
          updatedAt
          labels(first: 20) { nodes { name } }
          parent { url }
        }
      }
    }
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100) {
          nodes {
            id
            type
            updatedAt
            content {
              ... on Issue { url }
              ... on DraftIssue { title body }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2SingleSelectField { name } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const SET_BOARD_STATUS_MUTATION = `
  mutation SetBoardStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(
      input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }
    ) {
      projectV2Item { id }
    }
  }
`;

export const DELETE_BOARD_ITEM_MUTATION = `
  mutation DeleteBoardItem($projectId: ID!, $itemId: ID!) {
    deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
      deletedItemId
    }
  }
`;

export const DELETE_ISSUE_MUTATION = `
  mutation DeleteIssue($issueId: ID!) {
    deleteIssue(input: { issueId: $issueId }) {
      issue { id }
    }
  }
`;

export const CREATE_ISSUE_MUTATION = `
  mutation CreateIssue(
    $repositoryId: ID!
    $title: String!
    $body: String
    $labelIds: [ID!]
    $projectV2Ids: [ID!]
  ) {
    createIssue(
      input: {
        repositoryId: $repositoryId
        title: $title
        body: $body
        labelIds: $labelIds
        projectV2Ids: $projectV2Ids
      }
    ) {
      issue { id url }
    }
  }
`;

export const LABEL_QUERY = `
  query Label($owner: String!, $name: String!, $label: String!) {
    repository(owner: $owner, name: $name) {
      label(name: $label) { id }
    }
  }
`;

export const VIEWER_QUERY = `
  query Viewer {
    viewer { id login }
  }
`;

export const VIEWER_BOARDS_QUERY = `
  query ViewerBoards {
    viewer {
      projectsV2(first: 100) {
        nodes {
          id
          title
          createdAt
          repositories(first: 100) { nodes { url } }
        }
      }
    }
  }
`;

export const CREATE_BOARD_MUTATION = `
  mutation CreateBoard($ownerId: ID!, $title: String!) {
    createProjectV2(input: { ownerId: $ownerId, title: $title }) {
      projectV2 { id url }
    }
  }
`;

export const LINK_BOARD_MUTATION = `
  mutation LinkBoard($projectId: ID!, $repositoryId: ID!) {
    linkProjectV2ToRepository(
      input: { projectId: $projectId, repositoryId: $repositoryId }
    ) {
      repository { id }
    }
  }
`;

export const CREATE_STATUS_FIELD_MUTATION = `
  mutation CreateStatusField(
    $projectId: ID!
    $options: [ProjectV2SingleSelectFieldOptionInput!]!
  ) {
    createProjectV2Field(
      input: {
        projectId: $projectId
        dataType: SINGLE_SELECT
        name: "Status"
        singleSelectOptions: $options
      }
    ) {
      projectV2Field {
        ... on ProjectV2SingleSelectField {
          id
          name
          options { id name }
        }
      }
    }
  }
`;

export const SET_PROJECT_CLOSED_MUTATION = `
  mutation SetProjectClosed($projectId: ID!, $closed: Boolean!) {
    updateProjectV2(input: { projectId: $projectId, closed: $closed }) {
      projectV2 { id }
    }
  }
`;

export const RENAME_PROJECT_MUTATION = `
  mutation RenameProject($projectId: ID!, $title: String!) {
    updateProjectV2(input: { projectId: $projectId, title: $title }) {
      projectV2 { id }
    }
  }
`;

export const LOCK_TASK_MUTATION = `
  mutation LockTask($nodeId: ID!) {
    lockLockable(input: { lockableId: $nodeId }) {
      lockedRecord { ... on Issue { locked } }
    }
  }
`;

export const UNLOCK_TASK_MUTATION = `
  mutation UnlockTask($nodeId: ID!) {
    unlockLockable(input: { lockableId: $nodeId }) {
      unlockedRecord { ... on Issue { locked } }
    }
  }
`;

export const ADD_SUB_ISSUE_MUTATION = `
  mutation AddSubIssue($issueId: ID!, $subIssueId: ID!) {
    addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) {
      issue { id }
    }
  }
`;

export const REMOVE_SUB_ISSUE_MUTATION = `
  mutation RemoveSubIssue($issueId: ID!, $subIssueId: ID!) {
    removeSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) {
      issue { id }
    }
  }
`;
