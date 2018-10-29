import React from 'react';
import PropTypes from 'prop-types';
import { layout, select, behavior, event } from 'd3';
import clone from 'clone';
import deepEqual from 'deep-equal';
import uuid from 'uuid';

import NodeWrapper from './NodeWrapper';
import Node from '../Node';
import Link from '../Link';
import './style.css';

export default class Tree extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      data: this.assignInternalProperties(clone(props.data)),
      rd3tSvgClassName: `_${uuid.v4()}`,
      rd3tGClassName: `_${uuid.v4()}`,
    };
    this.internalState = {
      initialRender: true,
      targetNode: null,
      isTransitioning: false,
      isRerendered: false,
      d3: {
        scale: this.props.zoom,
        translate: this.props.translate,
      },
    };
    this.findNodesById = this.findNodesById.bind(this);
    this.collapseNode = this.collapseNode.bind(this);
    this.handleNodeToggle = this.handleNodeToggle.bind(this);
    this.handleOnClickCb = this.handleOnClickCb.bind(this);
    this.handleOnMouseOverCb = this.handleOnMouseOverCb.bind(this);
    this.handleOnMouseOutCb = this.handleOnMouseOutCb.bind(this);
  }

  componentWillMount() {
    this.internalState.d3 = this.calculateD3Geometry(this.props);
  }

  componentDidMount() {
    this.bindZoomListener(this.props);
    this.internalState.initialRender = false;
  }

  componentDidUpdate(prevProps) {
    // Rebind zoom listeners to new DOM nodes in case NodeWrapper switched <TransitionGroup> <-> <g>
    if (prevProps.transitionDuration !== this.props.transitionDuration) {
      this.bindZoomListener(this.props);
    }

    if (typeof this.props.onUpdate === 'function') {
      this.props.onUpdate({
        node: this.internalState.targetNode ? clone(this.internalState.targetNode) : null,
        zoom: this.internalState.d3.scale,
        translate: this.internalState.d3.translate,
      });

      this.internalState.targetNode = null;
    }
  }

  flatTreeStructure(node, map, childrenKey) {
    map[node.name] = node;
    if (node[childrenKey] && node[childrenKey].length) {
      node[childrenKey].forEach(child => {
        this.flatTreeStructure(child, map, childrenKey);
      });
    }
    return map;
  }

  componentWillReceiveProps(nextProps) {
    // Clone new data & assign internal properties
    const newPropsData = clone(nextProps.data);

    if (this.props.data !== nextProps.data && nextProps.externalCollapse) {
      const currentState = clone(this.state.data);

      const oldStateNodes = this.flatTreeStructure(currentState[0], {}, '_children');
      const newPropsNodes = this.flatTreeStructure(newPropsData[0], {}, 'children');

      // TODO: THIS IS SOOO BAADD, maybe diff on IDs ?
      if (oldStateNodes.length !== newPropsNodes.length) {
        this.internalState.isRerendered = true;
        this.setState(
          {
            data: this.assignInternalProperties(newPropsData),
          },
          () => {
            this.internalState.isRerendered = false;
          },
        );

        return;
      }

      Object.keys(oldStateNodes).forEach(nodeKey => {
        const node = oldStateNodes[nodeKey];
        if (newPropsNodes[node.name]) {
          node[nextProps.externalCollapse] = newPropsNodes[node.name][nextProps.externalCollapse];
          node.attributes = { ...newPropsNodes[node.name].attributes };
          if (nextProps.externalActive) {
            node[nextProps.externalActive] = newPropsNodes[node.name][nextProps.externalActive];
          }
          if (nextProps.externalNodeStyles) {
            node.styles = newPropsNodes[node.name].styles;
          }
        }
      });

      this.setState({
        data: currentState,
      });
    } else if (this.props.data !== nextProps.data) {
      this.setState({
        data: this.assignInternalProperties(newPropsData),
      });
    }

    this.internalState.d3 = this.calculateD3Geometry(nextProps);

    // If zoom-specific props change -> rebind listener with new values
    if (
      !deepEqual(this.props.translate, nextProps.translate) ||
      !deepEqual(this.props.scaleExtent, nextProps.scaleExtent) ||
      this.props.zoom !== nextProps.zoom
    ) {
      this.bindZoomListener(nextProps);
    }
  }

  /**
   * setInitialTreeDepth - Description
   *
   * @param {array} nodeSet Array of nodes generated by `generateTree`
   * @param {number} initialDepth Maximum initial depth the tree should render
   *
   * @return {void}
   */
  setInitialTreeDepth(nodeSet, initialDepth) {
    nodeSet.forEach(n => {
      n._collapsed = n.depth >= initialDepth;
    });
  }

  /**
   * bindZoomListener - If `props.zoomable`, binds a listener for
   * "zoom" events to the SVG and sets scaleExtent to min/max
   * specified in `props.scaleExtent`.
   *
   * @return {void}
   */
  bindZoomListener(props) {
    const { zoomable, scaleExtent, translate, zoom, onUpdate } = props;
    const { rd3tSvgClassName, rd3tGClassName } = this.state;
    const svg = select(`.${rd3tSvgClassName}`);
    const g = select(`.${rd3tGClassName}`);

    if (zoomable) {
      svg.call(
        behavior
          .zoom()
          .scaleExtent([scaleExtent.min, scaleExtent.max])
          .on('zoom', () => {
            g.attr('transform', `translate(${event.translate}) scale(${event.scale})`);
            if (typeof onUpdate === 'function') {
              // This callback is magically called not only on "zoom", but on "drag", as well,
              // even though event.type == "zoom".
              // Taking advantage of this and not writing a "drag" handler.
              onUpdate({
                node: null,
                zoom: event.scale,
                translate: { x: event.translate[0], y: event.translate[1] },
              });
              this.internalState.d3.scale = event.scale;
              this.internalState.d3.translate = { x: event.translate[0], y: event.translate[1] };
            }
          })
          // Offset so that first pan and zoom does not jump back to [0,0] coords
          .scale(zoom)
          .translate([translate.x, translate.y]),
      );
    }
  }

  /**
   * assignInternalProperties - Assigns internal properties to each node in the
   * `data` set that are required for tree manipulation and returns
   * a new `data` array.
   *
   * @param {array} data Hierarchical tree data
   *
   * @return {array} `data` array with internal properties added
   */
  assignInternalProperties(data) {
    return data.map(node => {
      node.id = uuid.v4();
      node._collapsed = false;
      // if there are children, recursively assign properties to them too
      if (node.children && node.children.length > 0) {
        node.children = this.assignInternalProperties(node.children);
        node._children = node.children;
      }
      return node;
    });
  }

  /**
   * findNodesById - Recursively walks the nested `nodeSet` until a node matching `nodeId` is found.
   *
   * @param {string} nodeId The `node.id` being searched for
   * @param {array} nodeSet Array of nested `node` objects
   * @param {array} hits Accumulator for matches, passed between recursive calls
   *
   * @return {array} Set of nodes matching `nodeId`
   */
  // TODO: Refactor this into a more readable/reasonable recursive depth-first walk.
  findNodesById(nodeId, nodeSet, hits) {
    if (hits.length > 0) {
      return hits;
    }

    hits = hits.concat(nodeSet.filter(node => node.id === nodeId));

    nodeSet.forEach(node => {
      if (node._children && node._children.length > 0) {
        hits = this.findNodesById(nodeId, node._children, hits);
      }
    });

    return hits;
  }

  /**
   * findNodesAtDepth - Recursively walks the nested `nodeSet` until all nodes at `depth` have been found.
   *
   * @param {number} depth Target depth for which nodes should be returned
   * @param {array} nodeSet Array of nested `node` objects
   * @param {array} accumulator Accumulator for matches, passed between recursive calls
   * @return
   */
  findNodesAtDepth(depth, nodeSet, accumulator) {
    accumulator = accumulator.concat(nodeSet.filter(node => node.depth === depth));

    nodeSet.forEach(node => {
      if (node._children && node._children.length > 0) {
        accumulator = this.findNodesAtDepth(depth, node._children, accumulator);
      }
    });

    return accumulator;
  }

  /**
   * collapseNode - Recursively sets the `_collapsed` property of
   * the passed `node` object and its children to `true`.
   *
   * @param {object} node Node object with custom properties
   *
   * @return {void}
   */
  collapseNode(node) {
    node._collapsed = true;
    this.unmarkNodeActive(node);
    if (node._children && node._children.length > 0) {
      node._children.forEach(child => {
        this.collapseNode(child);
      });
    }
  }

  /**
   * unmarkNodeActive - Sets the `_active` property of
   * the passed `node` object to `false`.
   *
   * @param {object} node Node object with custom properties
   *
   * @return {void}
   */
  unmarkNodeActive(node) {
    node._active = false;
  }

  /**
   * expandNode - Sets the `_collapsed` property of
   * the passed `node` object to `false`.
   *
   * @param {type} node Node object with custom properties
   *
   * @return {void}
   */
  expandNode(node) {
    node._collapsed = false;
  }

  /**
   * markNodeActive - Sets the `_active` property of
   * the passed `node` object to `true`.
   *
   * @param {type} node Node object with custom properties
   *
   * @return {void}
   */
  markNodeActive(node) {
    node._active = true;
  }

  getNodeCollapsedState(node) {
    if (this.props.externalCollapse) {
      return node[this.props.externalCollapse];
    }

    return node._collapsed;
  }

  /**
   * collapseNodeNeighbors - Collapses all nodes in `nodeSet` that are neighbors (same depth) of `targetNode`.
   *
   * @param {object} targetNode
   * @param {array} nodeSet
   *
   * @return {void}
   */
  collapseNeighborNodes(targetNode, nodeSet) {
    const neighbors = this.findNodesAtDepth(targetNode.depth, nodeSet, []).filter(
      node => node.id !== targetNode.id,
    );
    neighbors.forEach(neighbor => this.collapseNode(neighbor));
  }

  /**
   * handleNodeToggle - Finds the node matching `nodeId` and
   * expands/collapses it, depending on the current state of
   * its `_collapsed` property.
   * `setState` callback receives targetNode and handles
   * `props.onClick` if defined.
   *
   * @param {string} nodeId A node object's `id` field.
   *
   * @return {void}
   */
  handleNodeToggle(nodeId, evt) {
    const data = clone(this.state.data);
    const matches = this.findNodesById(nodeId, data, []);
    const targetNode = matches[0];

    if (this.props.collapsible && !this.state.isTransitioning) {
      if (targetNode._collapsed) {
        if (this.props.shouldAutoExpandChildren) {
          this.autoExpand(targetNode);
        } else {
          this.expandNode(targetNode);
        }
        this.props.shouldCollapseNeighborNodes && this.collapseNeighborNodes(targetNode, data);
      } else {
        this.collapseNode(targetNode);
      }
      // Lock node toggling while transition takes place
      this.setState({ data, isTransitioning: true }, () => this.handleOnClickCb(targetNode, evt));
      // Await transitionDuration + 10 ms before unlocking node toggling again
      setTimeout(
        () => this.setState({ isTransitioning: false }),
        this.props.transitionDuration + 10,
      );
      this.internalState.targetNode = targetNode;
    } else {
      this.handleOnClickCb(targetNode, evt);
    }
  }

  autoExpand(node) {
    const startingNode = node;

    if (
      !startingNode._children ||
      (startingNode._children && startingNode._children.length === 0)
    ) {
      return node;
    }

    // Expand the Root Node first
    this.expandNode(startingNode);
    this.markNodeActive(startingNode);

    let selectedChild = this.props.shouldAutoExpandChildren(startingNode);
    this.markNodeActive(selectedChild);

    while (selectedChild) {
      if (selectedChild._children && selectedChild._children.length) {
        this.expandNode(selectedChild);
        selectedChild = this.props.shouldAutoExpandChildren(selectedChild);
        this.markNodeActive(selectedChild);
      } else {
        selectedChild = undefined;
      }
    }

    return node;
  }

  /**
   * handleOnClickCb - Handles the user-defined `onClick` function
   *
   * @param {object} targetNode Description
   *
   * @return {void}
   */
  handleOnClickCb(targetNode, evt) {
    const { onClick } = this.props;
    if (onClick && typeof onClick === 'function') {
      onClick(clone(targetNode), evt);
    }
  }

  /**
   * handleOnMouseOverCb - Handles the user-defined `onMouseOver` function
   *
   * @param {string} nodeId
   *
   * @return {void}
   */
  handleOnMouseOverCb(nodeId, evt) {
    const { onMouseOver } = this.props;
    if (onMouseOver && typeof onMouseOver === 'function') {
      const data = clone(this.state.data);
      const matches = this.findNodesById(nodeId, data, []);
      const targetNode = matches[0];
      onMouseOver(clone(targetNode), evt);
    }
  }

  /**
   * handleOnMouseOutCb - Handles the user-defined `onMouseOut` function
   *
   * @param {string} nodeId
   *
   * @return {void}
   */
  handleOnMouseOutCb(nodeId, evt) {
    const { onMouseOut } = this.props;
    if (onMouseOut && typeof onMouseOut === 'function') {
      const data = clone(this.state.data);
      const matches = this.findNodesById(nodeId, data, []);
      const targetNode = matches[0];
      onMouseOut(clone(targetNode), evt);
    }
  }

  /**
   * restrictNodeHeightGrowth - Restricts height of the node siblings as they
   * grow so that they look more streamlined. Catered just for horizontal orientation right now.
   *
   */

  restrictNodeHeightGrowth(nodes, nodeSize) {
    nodes.forEach(node => {
      node.childrenCount = node.children ? node.children.length : 0;
      if (node.depth === 0) {
        return;
      }

      const childIndex = node.parent.children.findIndex(elem => elem.id === node.id);

      if (node.parent.childrenCount === 1 && node.depth === 1) {
        node.x = nodeSize.y / -2;
      } else if (node.parent.childrenCount === 1) {
        node.x = node.parent.x;
      } else if (node.parent.childrenCount === 2) {
        node.x = childIndex * nodeSize.y - nodeSize.y / 2;
        if (node.parent.x === nodeSize.y * -1.5) {
          node.x -= nodeSize.y;
        } else if (node.parent.x === nodeSize.y * 1.5) {
          node.x += nodeSize.y;
        }
      } else if (node.parent.childrenCount === 3) {
        node.x = childIndex * nodeSize.y - nodeSize.y * 1.5;
        if (node.parent.x === nodeSize.y / 2) {
          node.x += nodeSize.y;
        } else if (node.parent.x === nodeSize.y * 1.5) {
          node.x += nodeSize.y;
        }
      } else if (node.parent.childrenCount === 4) {
        node.x = childIndex * nodeSize.y - 1.5 * nodeSize.y;
      }
    });
  }

  /**
   * generateTree - Generates tree elements (`nodes` and `links`) by
   * grabbing the rootNode from `this.state.data[0]`.
   * Restricts tree depth to `props.initialDepth` if defined and if this is
   * the initial render of the tree.
   *
   * @return {object} Object containing `nodes` and `links`.
   */
  generateTree() {
    const {
      initialDepth,
      depthFactor,
      separation,
      nodeSize,
      orientation,
      boundHeight,
    } = this.props;
    const tree = layout
      .tree()
      .nodeSize(orientation === 'horizontal' ? [nodeSize.y, nodeSize.x] : [nodeSize.x, nodeSize.y])
      .separation(
        (a, b) => (a.parent.id === b.parent.id ? separation.siblings : separation.nonSiblings),
      )
      .children(d => (this.getNodeCollapsedState(d) ? null : d._children));

    const rootNode = this.state.data[0];
    let nodes = tree.nodes(rootNode);

    // set `initialDepth` on first render if specified
    if (
      initialDepth !== undefined &&
      (this.internalState.initialRender || this.internalState.isRerendered)
    ) {
      this.setInitialTreeDepth(nodes, initialDepth);
      nodes = tree.nodes(rootNode);
      if (this.props.shouldAutoExpandChildren) {
        this.autoExpand(nodes[0]);
      }
    }

    if (depthFactor) {
      nodes.forEach(node => {
        node.y = node.depth * depthFactor;
      });
    }

    if (boundHeight && orientation === 'horizontal') {
      this.restrictNodeHeightGrowth(nodes, nodeSize);
    }

    const links = tree.links(nodes);
    return { nodes, links };
  }

  /**
   * calculateD3Geometry - Set initial zoom and position.
   * Also limit zoom level according to `scaleExtent` on initial display. This is necessary,
   * because the first time we are setting it as an SVG property, instead of going
   * through D3's scaling mechanism, which would have picked up both properties.
   *
   * @param  {object} nextProps
   * @return {object} {translate: {x: number, y: number}, zoom: number}
   */
  calculateD3Geometry(nextProps) {
    let scale;

    if (nextProps.zoom > nextProps.scaleExtent.max) {
      scale = nextProps.scaleExtent.max;
    } else if (nextProps.zoom < nextProps.scaleExtent.min) {
      scale = nextProps.scaleExtent.min;
    } else {
      scale = nextProps.zoom;
    }

    return {
      translate: nextProps.translate,
      scale,
    };
  }

  render() {
    const { nodes, links } = this.generateTree();
    const { rd3tSvgClassName, rd3tGClassName } = this.state;
    const {
      nodeSvgShape,
      nodeLabelComponent,
      orientation,
      pathFunc,
      transitionDuration,
      zoomable,
      textLayout,
      nodeSize,
      depthFactor,
      initialDepth,
      separation,
      circleRadius,
      allowForeignObjects,
      styles,
      externalNodeStyles,
    } = this.props;
    const { translate, scale } = this.internalState.d3;

    const subscriptions = {
      ...nodeSize,
      ...separation,
      depthFactor,
      initialDepth,
    };

    return (
      <div className={`rd3t-tree-container ${zoomable ? 'rd3t-grabbable' : undefined}`}>
        <svg className={rd3tSvgClassName} width="100%" height="100%">
          <NodeWrapper
            transitionDuration={transitionDuration}
            component="g"
            className={rd3tGClassName}
            transform={`translate(${translate.x},${translate.y}) scale(${scale})`}
          >
            {links.map(linkData => (
              <Link
                key={uuid.v4()}
                orientation={orientation}
                pathFunc={pathFunc}
                linkData={linkData}
                transitionDuration={transitionDuration}
                styles={styles.links}
              />
            ))}

            {nodes.map(nodeData => (
              <Node
                key={nodeData.id}
                nodeSvgShape={{ ...nodeSvgShape, ...nodeData.nodeSvgShape }}
                nodeLabelComponent={nodeLabelComponent}
                nodeSize={nodeSize}
                orientation={orientation}
                transitionDuration={transitionDuration}
                nodeData={nodeData}
                name={nodeData.name}
                attributes={nodeData.attributes}
                onClick={this.handleNodeToggle}
                onMouseOver={this.handleOnMouseOverCb}
                onMouseOut={this.handleOnMouseOutCb}
                textLayout={textLayout}
                circleRadius={circleRadius}
                subscriptions={subscriptions}
                allowForeignObjects={allowForeignObjects}
                styles={externalNodeStyles ? nodeData.styles : styles.nodes}
              />
            ))}
          </NodeWrapper>
        </svg>
      </div>
    );
  }
}

Tree.defaultProps = {
  nodeSvgShape: {
    shape: 'circle',
    shapeProps: {
      r: 10,
    },
  },
  nodeLabelComponent: null,
  onClick: undefined,
  onMouseOver: undefined,
  onMouseOut: undefined,
  onUpdate: undefined,
  shouldAutoExpandChildren: undefined,
  orientation: 'horizontal',
  translate: { x: 0, y: 0 },
  pathFunc: 'diagonal',
  boundHeight: false,
  transitionDuration: 500,
  depthFactor: undefined,
  collapsible: true,
  externalCollapse: undefined,
  externalActive: undefined,
  externalNodeStyles: false,
  initialDepth: undefined,
  zoomable: true,
  zoom: 1,
  scaleExtent: { min: 0.1, max: 1 },
  nodeSize: { x: 140, y: 140 },
  separation: { siblings: 1, nonSiblings: 2 },
  textLayout: {
    textAnchor: 'start',
    x: 10,
    y: -10,
    transform: undefined,
  },
  allowForeignObjects: false,
  shouldCollapseNeighborNodes: false,
  circleRadius: undefined, // TODO: DEPRECATE
  styles: {},
};

Tree.propTypes = {
  data: PropTypes.array.isRequired,
  nodeSvgShape: PropTypes.shape({
    shape: PropTypes.string,
    shapeProps: PropTypes.object,
  }),
  nodeLabelComponent: PropTypes.object,
  onClick: PropTypes.func,
  onMouseOver: PropTypes.func,
  onMouseOut: PropTypes.func,
  onUpdate: PropTypes.func,
  shouldAutoExpandChildren: PropTypes.func,
  orientation: PropTypes.oneOf(['horizontal', 'vertical']),
  translate: PropTypes.shape({
    x: PropTypes.number,
    y: PropTypes.number,
  }),
  pathFunc: PropTypes.oneOfType([
    PropTypes.oneOf(['diagonal', 'elbow', 'straight']),
    PropTypes.func,
  ]),
  boundHeight: PropTypes.bool,
  transitionDuration: PropTypes.number,
  depthFactor: PropTypes.number,
  collapsible: PropTypes.bool,
  externalCollapse: PropTypes.string,
  externalActive: PropTypes.string,
  externalNodeStyles: PropTypes.bool,
  initialDepth: PropTypes.number,
  zoomable: PropTypes.bool,
  zoom: PropTypes.number,
  scaleExtent: PropTypes.shape({
    min: PropTypes.number,
    max: PropTypes.number,
  }),
  nodeSize: PropTypes.shape({
    x: PropTypes.number,
    y: PropTypes.number,
  }),
  separation: PropTypes.shape({
    siblings: PropTypes.number,
    nonSiblings: PropTypes.number,
  }),
  textLayout: PropTypes.object,
  allowForeignObjects: PropTypes.bool,
  shouldCollapseNeighborNodes: PropTypes.bool,
  circleRadius: PropTypes.number,
  styles: PropTypes.shape({
    nodes: PropTypes.object,
    links: PropTypes.object,
  }),
};
