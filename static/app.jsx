var config = {
  debug: true,
  defaultUrl: 'http://ya.ru\nhttp://google.com\nhttp://facebook.com\nhttp://mail.ru',
  urls: {
    site: 'http://truetug.info/',
    ws: 'ws://127.0.0.1:8888/websocket/',
    task: '/api/task/',
  },
  author: 'tug',
  taskBoxRefreshPeriodicity: 500,
  paginationNear: 3,
},
log = function(){
  if(config.debug && window.console !== undefined)
  console.log.apply(this, arguments);
},
sock = window.WebSocket === undefined && function(){
  log('Websocket is not available'); 

  return {
    send: function(){}
  }}() || function(){
    var timeout = 500,
      ws,
      connect = function(){ 
        ws = new WebSocket(config.urls.ws);
        ws.onopen = function(event){ log('connected', event) };
        ws.onclose = function(event){ 
          log('close', event, 'reconnect in', timeout);
          setTimeout(connect, timeout);
          timeout = timeout * 2;
        };
        ws.onerror = function(event){ log('error', event) };
        ws.onmessage = function(event){ log('message', event) };
      },
      send = function(data){
        log('Sending data', data, ws);

        if(ws){
          ws.send(JSON.stringify(data));
        }
        else {
          log('Websocket down, try resend in', timeout);
          setTimeout(this.send(), timeout);
        }
      };

  connect();
  return {
    send: send
  }
}(),
now = new Date();

var Root = React.createClass({
  render: function(){
    return (
      <div>
        <TasksBox />
      </div>
    )
  }
}),
Paginator = React.createClass({
  render: function(){
    var first = Math.max(this.props.current - config.paginationNear, 0),
        last = Math.min(this.props.current + config.paginationNear, this.props.total - 1),
        pageList = [];

    pageList.push({
      number: Math.max(this.props.current - 1, 0),
      cls: 'pagination-previous',
      title: 'Previous page',
      display: 'Previous',
      isDisabled: this.props.current == 0
    });

    for(let i=first; i<=last; i++) {
      let display = i + 1;

      pageList.push({
        number: i,
        display: display,
        title: 'Page ' + display,
        url: config.urls.task + '?page=' + i,
        isCurrent: i == this.props.current
      });
    };

    pageList.push({
      number: Math.min(this.props.current + 1, this.props.total - 1),
      cls: 'pagination-next',
      title: 'Next page',
      display: 'Next',
      isDisabled: this.props.current >= this.props.total - 1
    });

    return (
      <div className="b-pagination">
        <div className="row">
          <div className="small-12 column">
            <ul className="pagination text-center" role="navigation" aria-label="Pagination">
              {pageList.map((item, i) => {
                let itemCls = [item.cls, item.isDisabled && 'disabled', item.isCurrent && 'current'].map((cls) => cls || '').join(' ').trim();
                
                return (item.isCurrent || item.isDisabled) ? (
                  <li key={i} className={itemCls}>
                    <span className="show-for-sr">You are on page</span> {item.display}
                  </li>
                ) : (
                  <li key={i} className={itemCls}>
                    <a href={item.url} aria-label={item.title} onClick={this.props.handlePageChange.bind(null, item.number)}>{item.display}</a>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    )
  }
}),
TasksBox = React.createClass({
  getInitialState: function() {
    return {
      page: 0,
      url: config.defaultUrl,
      date: null,
      tasks: []
    };
  },
  componentDidMount: function() {
    this.loadDataFromServer();
    setInterval(this.loadDataFromServer, config.taskBoxRefreshPeriodicity);
  },
  loadDataFromServer: function() {
    var _this = this;

    axios.get(config.urls.task, {
      params: {page: this.state.page}
    })
      .then(function(response){
        _this.setState({
          tasks: response.data.objects,
          paging: response.data.meta
        });
      })
      .catch(function(error) {
        console.log(error);
      });
  },
  handlePageChange: function(page, e) {
    e.preventDefault();
    this.setState({page: page});
  },
  handleChangeUrl: function(e) {
    this.setState({url: e.target.value});
  },
  handleChangeDate: function(e) {
    this.setState({date: e.target.value});
  },
  handleAddTask: function(e) {
    e.preventDefault();

    this.state.url.split('\n').map(url => {
      axios.post(config.urls.task, {
        url: url.trim(),
        date: this.state.date
      })
        .then(function(response) {
          log('Add task', response);
        })
        .catch(function(error) {
          console.log(error);
        });
    })

    this.setState({url: '', date: null});
  },
  handleRemoveTask: function(slug, e){
    e.preventDefault();
    var _this = this,
        url = config.urls.task + slug + '/';

    if(window.confirm('Are you really want to remove the task?'))
    axios.delete(url, {})
      .then(function(response) {
        log('Delete task', response);
      })
      .catch(function(error) {
        console.log(error);
      });
  },
  render: function() {
    return (
      <div className="b-tasksbox">

        <div className="top-bar">
          <div className="top-bar-title">
            <strong>LinkEater</strong>
          </div>
        </div>

        <TasksForm
          url={this.state.url}
          date={this.state.date}
          handleAddTask={this.handleAddTask}
          handleChangeUrl={this.handleChangeUrl}
          handleChangeDate={this.handleChangeDate} />

        <hr />

        <TasksList
          handleRemoveTask={this.handleRemoveTask}
          handlePageChange={this.handlePageChange}
          {...this.state} />

        <footer className="b-footer">
          <div className="row">
            <div className="column text-center">
              <small>© <a href="{config.urls.site}">{config.author}</a>, {now.getFullYear()}</small>
            </div>
          </div>
        </footer>
      </div>
    );
  }
}),
TasksList = React.createClass({
  render: function() {
    return (
        <div className="b-taskslist">
          <div className="row">
          {this.props.tasks.map((task) => {
            var progressCls = ['progress', task.style].join(' '),
                progressStl = {width: task.progress + '%'},
                taskStl = (task.image) ? {
                  backgroundImage: 'url(' + task.image + ')', 
                  backgroundPosition: 'top center',
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: 'contain',
                } : {},
                taskTitle = (task.progress == 100) ? task.url : task.url + ' (' + task.dl + ' kb)',
                taskScreenshotStl = {
                  backgroundImage: 'url(' + task.screenshot + ')', 
                  backgroundPosition: 'top center',
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: 'cover',
                  width: '100%',
                  height: '200px',
                  overflow: 'hidden',
                  borderBottom: '1px dashed #CCC',
                },
                taskScreenshot = (task.screenshot) ? (
                  <div>
                    <p>Screenshot:</p>
                    <div style={taskScreenshotStl}></div>
                  </div>
                ) : '';

            return (
              <div key={task.slug} className="small-12 medium-12 large-4 column" style={taskStl}>
                <div className="media-object stack-for-small">
                  <div className="media-object-section main-section">
                    <h3>{task.title} <a className="alert button tiny" href="#" onClick={this.props.handleRemoveTask.bind(null, task.slug)}><i className="fi-x"></i></a></h3>
                    <p>URL: <a href={task.url}>{task.url}</a></p>
                    <p>Size: {task.dl} kb</p>
                    <p>Heading: {task.heading}</p>
                    <p>{task.message}</p>
                    <p>Progress:</p>
                    <div className={progressCls}>
                      <div className="progress-meter" style={progressStl}></div>
                    </div>
                    {taskScreenshot}
                  </div>
                </div>
              </div>
            )
          })}
          </div>

          <Paginator
            {...this.props.paging}
            handlePageChange={this.props.handlePageChange} />
        </div>
    )
  }
}),
TasksForm = React.createClass({
  render: function(){
    return (
      <div className="b-taskform">
        <div className="row">
          <div className="small-12 columns">
            <form onSubmit={this.props.handleAddTask}>
              <label htmlFor="id_url">Parse following URLs: </label>
              <textarea
                id="id_url"
                rows="5"
                value={this.props.url}
                placeholder="Enter urls to parse"
                onChange={this.props.handleChangeUrl}></textarea>
              <label htmlFor="id_date">Schedule on: </label>
              <input
                id="id_date"
                type="datetime-local"
                min={this.props.date}
                onChange={this.props.handleChangeDate} />
              <button type="submit" className="success button">Add tasks</button>
            </form>
          </div>
        </div>
      </div>
    )
  }
});

ReactDOM.render(<TasksBox />, document.getElementById('content'));
